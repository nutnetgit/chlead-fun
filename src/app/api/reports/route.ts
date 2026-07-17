import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

// Manager reports: filtered aggregates for the /reports page.
// Filters: from, to (lead created date), brandId, branchId, ownerId.
//
// Branch scoping (bug found 2026-07-15, same class as the 2026-07-14 audit —
// this page was built after that audit and never got the same treatment): a
// manager's query previously had ZERO server-side restriction — only the
// filters the client happened to send. Combined via a Prisma `AND` array
// (not a flat where object) so a client-requested brandId/branchId can only
// ever NARROW within the manager's own scope, never escape it: a lead must
// satisfy branchScope AND the requested filter simultaneously.
export async function GET(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  let branchScope: number[] | null = null;
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (allowed.length) branchScope = allowed;
  }

  const p = request.nextUrl.searchParams;
  const from = p.get("from") ? new Date(`${p.get("from")}T00:00:00`) : new Date(Date.now() - 90 * 864e5);
  const to = p.get("to") ? new Date(`${p.get("to")}T23:59:59`) : new Date();
  const brandId = p.get("brandId") ? Number(p.get("brandId")) : null;
  const branchId = p.get("branchId") ? Number(p.get("branchId")) : null;
  const ownerId = p.get("ownerId") ? Number(p.get("ownerId")) : null;

  const where = {
    AND: [
      { createdAt: { gte: from, lte: to } },
      branchScope ? { branchId: { in: branchScope } } : {},
      brandId ? { brandId } : {},
      branchId ? { branchId } : {},
      ownerId ? { ownerUserId: ownerId } : {},
    ],
  };

  const leads = await prisma.lead.findMany({
    where,
    include: { channel: true, brand: true, branch: true, person: true },
  });
  const users = await prisma.funUser.findMany();
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));

  const CONVERTED = new Set(["booking", "contract", "delivered", "won"]);
  const count = <K extends string>(fn: (l: (typeof leads)[number]) => K | null) => {
    const m = new Map<K, { leads: number; booked: number }>();
    for (const l of leads) {
      const k = fn(l);
      if (k === null) continue;
      const cur = m.get(k) ?? { leads: 0, booked: 0 };
      cur.leads++;
      if (CONVERTED.has(l.stage)) cur.booked++;
      m.set(k, cur);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v, rate: v.leads ? v.booked / v.leads : 0 }))
      .sort((a, b) => b.leads - a.leads);
  };

  // weekly trend (created per week), overall + split by channel category
  // (user req 2026-07-15 — "วัดประสิทธิภาพของ lead ตามช่องทางต่างๆ").
  const weekly = new Map<string, number>();
  const weeklyBySource = new Map<string, Map<string, number>>();
  const weekKeyOf = (d: Date) => {
    const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  };
  for (const l of leads) {
    if (!l.createdAt) continue;
    const k = weekKeyOf(new Date(l.createdAt));
    weekly.set(k, (weekly.get(k) ?? 0) + 1);
    const bySource = weeklyBySource.get(k) ?? new Map<string, number>();
    const cat = l.channel.category;
    bySource.set(cat, (bySource.get(cat) ?? 0) + 1);
    weeklyBySource.set(k, bySource);
  }
  // Same 12-week cap as the overall trend, same week keys so both charts
  // line up exactly.
  const weekKeys = [...weekly.keys()].sort((a, b) => a.localeCompare(b)).slice(-12);
  const sourceCategories = [...new Set(leads.map((l) => l.channel.category))];

  return NextResponse.json({
    range: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
    totals: {
      leads: leads.length,
      booked: leads.filter((l) => CONVERTED.has(l.stage)).length,
      lost: leads.filter((l) => l.status === "lost").length,
      active: leads.filter((l) => l.status === "active").length,
      conflicts: leads.filter((l) => l.temperatureConflict).length,
    },
    byStage: count((l) => l.stage),
    bySource: count((l) => l.channel.category),
    byBrand: count((l) => l.brand.brandName),
    byOwner: count((l) => (l.ownerUserId ? (userName.get(l.ownerUserId) ?? `#${l.ownerUserId}`) : "ไม่มีเจ้าของ")),
    // Capped to the most recent 12 weeks (user req 2026-07-14: a wide date
    // range squeezed the bars down to unreadable slivers) — the underlying
    // totals/aggregates above still cover the full selected range, only this
    // chart's x-axis is capped.
    weekly: weekKeys.map((week) => ({ week, n: weekly.get(week) ?? 0 })),
    weeklyBySource: {
      categories: sourceCategories,
      weeks: weekKeys.map((week) => ({
        week,
        counts: Object.fromEntries(sourceCategories.map((c) => [c, weeklyBySource.get(week)?.get(c) ?? 0])),
      })),
    },
  });
}
