import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Manager reports: filtered aggregates for the /reports page.
// Filters: from, to (lead created date), brandId, branchId, ownerId.
export async function GET(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const p = request.nextUrl.searchParams;
  const from = p.get("from") ? new Date(`${p.get("from")}T00:00:00`) : new Date(Date.now() - 90 * 864e5);
  const to = p.get("to") ? new Date(`${p.get("to")}T23:59:59`) : new Date();
  const where = {
    createdAt: { gte: from, lte: to },
    ...(p.get("brandId") ? { brandId: Number(p.get("brandId")) } : {}),
    ...(p.get("branchId") ? { branchId: Number(p.get("branchId")) } : {}),
    ...(p.get("ownerId") ? { ownerUserId: Number(p.get("ownerId")) } : {}),
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

  // weekly trend (created per week)
  const weekly = new Map<string, number>();
  for (const l of leads) {
    if (!l.createdAt) continue;
    const d = new Date(l.createdAt);
    const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7)); monday.setHours(0, 0, 0, 0);
    const k = monday.toISOString().slice(0, 10);
    weekly.set(k, (weekly.get(k) ?? 0) + 1);
  }

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
    weekly: [...weekly.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, n]) => ({ week, n })),
  });
}
