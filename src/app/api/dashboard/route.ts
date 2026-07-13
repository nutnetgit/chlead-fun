import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

/**
 * Manager dashboard v2 (user req 2026-07-11, brainstormed layout): every
 * number must lead to a manager action, not vanity metrics.
 *   ① Action Zone — pending escalations (actionable inline), stale HOT leads,
 *     unclaimed pool, unanswered customer chats.
 *   ② Team Scorecard — per-salesperson: leads held, overdue, avg first
 *     response, activities/day (7d), bookings (this month), conversion (90d
 *     created-cohort → booking).
 *   Plus the original funnel/temperature/recent-events blocks (kept).
 * Time windows are 7/30/90-day rolling — managers run in cycles, not
 * all-time totals.
 */
const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    active, dueToday, byTemp, byStage, openBreaches, poolWaiting, conflicts, recentEvents,
    pendingEscalations, staleHotLeads, oldestPool,
    salespeople, activeLeads, activities7d, bookingsMonth, cohort90,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: "active" } }),
    prisma.lead.count({ where: { status: "active", nextActionAt: { lte: endOfToday } } }),
    prisma.lead.groupBy({ by: ["temperature"], where: { status: "active" }, _count: true }),
    prisma.lead.groupBy({ by: ["stage"], where: { status: "active" }, _count: true }),
    prisma.slaEvent.count({ where: { resolvedAt: null } }),
    prisma.leadPool.count({ where: { claimedAt: null } }),
    prisma.lead.count({ where: { status: "active", temperatureConflict: 1 } }),
    prisma.slaEvent.findMany({
      orderBy: { eventId: "desc" }, take: 10,
      include: { lead: { include: { person: true, brand: true } } },
    }),
    // ── Action Zone ─────────────────────────────────────────────────────
    prisma.slaEvent.findMany({
      where: { eventType: "idle_escalate", resolvedAt: null },
      orderBy: { detectedAt: "asc" }, take: 8,
      include: { lead: { include: { person: true, brand: true } } },
    }),
    prisma.lead.findMany({
      where: { status: "active", temperature: "hot", lastActivityAt: { lt: d7 } },
      orderBy: { lastActivityAt: "asc" }, take: 5,
      include: { person: true, brand: true },
    }),
    prisma.leadPool.findFirst({ where: { claimedAt: null }, orderBy: { enteredAt: "asc" } }),
    // ── Scorecard raw data (aggregated in JS — team sizes are small) ─────
    prisma.funUser.findMany({ where: { isActive: 1, role: "sales" } }),
    prisma.lead.findMany({
      where: { status: "active", ownerUserId: { not: null } },
      select: { ownerUserId: true, nextActionAt: true, createdAt: true, firstResponseAt: true },
    }),
    prisma.activity.groupBy({
      by: ["createdBy"],
      where: { createdAt: { gte: d7 }, createdBy: { not: null }, direction: { in: ["outbound", "internal"] } },
      _count: true,
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "booking", changedAt: { gte: startMonth } },
      include: { lead: { select: { ownerUserId: true } } },
    }),
    prisma.lead.findMany({
      where: { createdAt: { gte: d90 }, ownerUserId: { not: null } },
      select: { ownerUserId: true, stage: true, createdAt: true, firstResponseAt: true },
    }),
  ]);

  // ── unanswered chats: latest message per lead is inbound ───────────────
  const latestChat = await prisma.chatMessage.findMany({
    where: { leadId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 300, // recent window is plenty — anything older than this is stale anyway
  });
  const seen = new Set<string>();
  const unansweredChats: { leadId: number; waitingSince: Date | null }[] = [];
  for (const m of latestChat) {
    const key = String(m.leadId);
    if (seen.has(key)) continue;
    seen.add(key);
    if (m.direction === "inbound") unansweredChats.push({ leadId: Number(m.leadId), waitingSince: m.createdAt });
  }
  const unansweredDetail = unansweredChats.length ? await prisma.lead.findMany({
    where: { leadId: { in: unansweredChats.slice(0, 5).map((u) => BigInt(u.leadId)) } },
    include: { person: true, brand: true },
  }) : [];
  const ownerIds = [...new Set(unansweredDetail.map((l) => l.ownerUserId).filter((x): x is number => x !== null))];
  const ownersForChats = ownerIds.length ? await prisma.funUser.findMany({ where: { userId: { in: ownerIds } } }) : [];
  const ownerName = new Map(ownersForChats.map((u) => [u.userId, u.nickname || u.displayName]));

  // ── scorecard assembly ─────────────────────────────────────────────────
  const scorecard = salespeople.map((sp) => {
    const held = activeLeads.filter((l) => l.ownerUserId === sp.userId);
    const overdue = held.filter((l) => l.nextActionAt && l.nextActionAt < startToday).length;
    const myCohort = cohort90.filter((l) => l.ownerUserId === sp.userId);
    const responded = myCohort.filter((l) => l.firstResponseAt && l.createdAt);
    const avgFirstResponseMin = responded.length
      ? Math.round(responded.reduce((s, l) => s + (l.firstResponseAt!.getTime() - l.createdAt!.getTime()), 0) / responded.length / 60000)
      : null;
    const acts = activities7d.find((a) => a.createdBy === sp.userId)?._count ?? 0;
    const bookings = bookingsMonth.filter((h) => h.lead.ownerUserId === sp.userId).length;
    const cohortBooked = myCohort.filter((l) => l.stage === "booking").length;
    return {
      userId: sp.userId,
      name: sp.nickname || sp.displayName,
      leadsHeld: held.length,
      overdue,
      avgFirstResponseMin,
      activitiesPerDay: Math.round((acts / 7) * 10) / 10,
      bookingsMonth: bookings,
      conversion: myCohort.length ? Math.round((cohortBooked / myCohort.length) * 100) : null,
    };
  }).sort((a, b) => b.overdue - a.overdue || (b.avgFirstResponseMin ?? 0) - (a.avgFirstResponseMin ?? 0));

  const custName = (l: { person: { nickname: string | null; firstName: string | null } }) =>
    l.person.nickname || l.person.firstName || "ไม่ระบุชื่อ";
  const daysAgo = (d: Date | null) => d ? Math.floor((now.getTime() - d.getTime()) / DAY) : null;

  return NextResponse.json({
    active, dueToday, openBreaches, poolWaiting, conflicts,
    byTemperature: Object.fromEntries(byTemp.map((t) => [t.temperature ?? "unscored", t._count])),
    byStage: Object.fromEntries(byStage.map((s) => [s.stage, s._count])),
    recentEvents: recentEvents.map((e) => ({
      eventId: Number(e.eventId),
      type: e.eventType,
      at: e.detectedAt,
      resolved: !!e.resolvedAt,
      resolution: e.resolution,
      leadId: Number(e.leadId),
      customerName: custName(e.lead),
      brand: e.lead.brand.brandName,
    })),
    actionZone: {
      escalations: pendingEscalations.map((e) => ({
        leadId: Number(e.leadId),
        customerName: custName(e.lead),
        brand: e.lead.brand.brandName,
        daysWaiting: daysAgo(e.detectedAt),
      })),
      staleHot: staleHotLeads.map((l) => ({
        leadId: Number(l.leadId),
        customerName: custName(l),
        brand: l.brand.brandName,
        daysIdle: daysAgo(l.lastActivityAt),
      })),
      pool: { waiting: poolWaiting, oldestDays: daysAgo(oldestPool?.enteredAt ?? null) },
      unansweredChats: unansweredDetail.map((l) => {
        const u = unansweredChats.find((x) => x.leadId === Number(l.leadId));
        return {
          leadId: Number(l.leadId),
          customerName: custName(l),
          brand: l.brand.brandName,
          ownerName: l.ownerUserId ? ownerName.get(l.ownerUserId) ?? null : null,
          hoursWaiting: u?.waitingSince ? Math.round((now.getTime() - u.waitingSince.getTime()) / 3600000) : null,
        };
      }),
      unansweredTotal: unansweredChats.length,
    },
    scorecard,
  });
}
