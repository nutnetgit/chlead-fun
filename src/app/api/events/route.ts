import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

// Events (manager-configured, stored in fun_campaign + junctions).
// ?active=1 → only events running today (for the sales QR picker).
// Metrics come along: actual lead counts per event and per salesperson.
//
// Branch scoping (user req 2026-07-13): every role still SEES every event —
// cross-branch visibility is useful (who's at which mall). Only writes are
// scoped: manager may create/edit/delete events of their own branches only;
// branch NULL = central event, admin/gm-managed. `canEdit` is computed here
// so the page can hide buttons, but PUT/DELETE re-check server-side.
export async function GET(request: NextRequest) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;
  const myBranchIds = rq.role === "manager" ? await managerAllowedBranchIds(rq.funUserId!) : null;

  const activeOnly = request.nextUrl.searchParams.get("active") === "1";
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const events = await prisma.campaign.findMany({
    where: activeOnly ? { startDate: { lte: today }, endDate: { gte: today } } : {},
    include: { brands: true, targets: true },
    orderBy: { campaignId: "desc" },
  });
  if (events.length === 0) return NextResponse.json([]);

  const ids = events.map((e) => e.campaignId);
  const leadCounts = await prisma.lead.groupBy({
    by: ["campaignId", "ownerUserId"],
    where: { campaignId: { in: ids } },
    _count: true,
  });

  const [brands, users, branches] = await Promise.all([
    prisma.brand.findMany(),
    prisma.funUser.findMany(),
    prisma.branch.findMany(),
  ]);
  const brandName = new Map(brands.map((b) => [b.brandId, b.brandName]));
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));
  const branchName = new Map(branches.map((b) => [b.branchId, b.branchName]));

  return NextResponse.json(events.map((e) => {
    const counts = leadCounts.filter((c) => c.campaignId === e.campaignId);
    const totalLeads = counts.reduce((s, c) => s + c._count, 0);
    const canEdit =
      rq.role === "admin" || rq.role === "gm" ||
      (rq.role === "manager" && e.branchId !== null && (myBranchIds ?? []).includes(e.branchId));
    return {
      eventId: e.campaignId,
      eventName: e.campaignName,
      startDate: e.startDate, endDate: e.endDate,
      targetLeads: e.targetLeads,
      linePromoMessage: e.linePromoMessage,
      branchId: e.branchId,
      branchName: e.branchId !== null ? branchName.get(e.branchId) ?? "?" : null,
      canEdit,
      totalLeads,
      brands: e.brands.map((b) => ({ brandId: b.brandId, brandName: brandName.get(b.brandId) ?? "?", targetLeads: b.targetLeads })),
      targets: e.targets.map((t) => ({
        userId: t.userId,
        displayName: userName.get(t.userId) ?? "?",
        targetLeads: t.targetLeads,
        actualLeads: counts.find((c) => c.ownerUserId === t.userId)?._count ?? 0,
      })),
    };
  }));
}

// Create event. Body: { eventName, startDate, endDate, branchId?,
// brands: {brandId, targetLeads?}[], targets: {userId, targetLeads}[] }
//
// targetLeads (user req 2026-07-17): no longer a client-supplied flat field —
// a multi-brand event used to take ONE combined number and attribute the
// FULL thing to every attending brand on Run Rate (a 3-brand event with
// targetLeads=90 showed 90 as EACH brand's own event-lead target, not a
// split). Each brand now gets its own optional target; the whole-event
// total is derived here as their sum, same convention as Run Rate's team
// booking target (derive the aggregate, don't hand-enter it separately).
export function sumBrandTargets(brands: { brandId?: unknown; targetLeads?: unknown }[]): { valid: { brandId: number; targetLeads: number | null }[]; total: number | null } {
  const valid = brands
    .filter((x): x is { brandId: number; targetLeads?: unknown } => Number.isInteger(x.brandId))
    .map((x) => ({ brandId: x.brandId, targetLeads: typeof x.targetLeads === "number" && x.targetLeads > 0 ? x.targetLeads : null }));
  const any = valid.some((x) => x.targetLeads !== null);
  const total = any ? valid.reduce((s, x) => s + (x.targetLeads ?? 0), 0) : null;
  return { valid, total };
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.eventName === "string" ? b.eventName.trim() : "";
  if (!name || !b.startDate || !b.endDate) {
    return NextResponse.json({ error: "missing eventName/startDate/endDate" }, { status: 400 });
  }

  // Branch ownership: a manager must file the event under one of their own
  // branches (no central events from managers); admin/gm may pass null for a
  // group-wide event.
  const branchId = Number.isInteger(b.branchId) ? (b.branchId as number) : null;
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (branchId === null || !allowed.includes(branchId)) {
      return NextResponse.json({ error: "ผู้จัดการต้องระบุสาขาของตัวเองเป็นเจ้าของ event" }, { status: 403 });
    }
  }
  const eventChannel =
    (await prisma.sourceChannel.findFirst({ where: { channelName: "Event / บูธ" } })) ??
    (await prisma.sourceChannel.create({ data: { channelName: "Event / บูธ", category: "event" } }));

  const { valid: brands, total: derivedTargetLeads } = sumBrandTargets(Array.isArray(b.brands) ? b.brands as { brandId?: unknown; targetLeads?: unknown }[] : []);

  const ev = await prisma.campaign.create({
    data: {
      campaignName: name,
      channelId: eventChannel.channelId,
      branchId,
      startDate: new Date(String(b.startDate)),
      endDate: new Date(String(b.endDate)),
      targetLeads: derivedTargetLeads,
      linePromoMessage: typeof b.linePromoMessage === "string" ? b.linePromoMessage.trim() || null : null,
    },
  });
  if (brands.length) {
    await prisma.campaignBrand.createMany({ data: brands.map((br) => ({ campaignId: ev.campaignId, brandId: br.brandId, targetLeads: br.targetLeads })) });
  }
  const targets = Array.isArray(b.targets) ? (b.targets as { userId?: number; targetLeads?: number }[]) : [];
  const targetRows = targets.filter((t) => Number.isInteger(t.userId)).map((t) => ({
    campaignId: ev.campaignId, userId: t.userId as number, targetLeads: Number(t.targetLeads) || 0,
  }));
  if (targetRows.length) await prisma.campaignTarget.createMany({ data: targetRows });

  return NextResponse.json({ ok: true, eventId: ev.campaignId }, { status: 201 });
}
