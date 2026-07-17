import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

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

export async function GET(req: Request) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  // Branch scoping (bug found 2026-07-14: every query here was completely
  // unscoped — a manager saw HOT-stale leads, SLA events, and scorecard
  // numbers from brands/branches they don't manage at all, which is why the
  // "HOT ค้างเกิน 7 วัน" count didn't reconcile with Lead Center's own list,
  // itself already properly branch-scoped). admin/gm stay global; a manager
  // with no branch links falls back to everything (same graceful rule used
  // everywhere else in the app).
  let branchScope: number[] | null = null;
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (allowed.length) branchScope = allowed;
  }

  // Brand filter (user req 2026-07-14, same class of bug as Run Rate's
  // pre-rework "combined" view: a rep who sells more than one brand made the
  // scorecard's bookings/conversion numbers ambiguous mixes across brands).
  // Optional ?brandId= — when set, every lead-derived query below is scoped
  // to it in addition to the branch scope.
  const brandIdParam = new URL(req.url).searchParams.get("brandId");
  const brandFilter = brandIdParam ? Number(brandIdParam) : null;

  const leadBranchWhere = {
    ...(branchScope ? { branchId: { in: branchScope } } : {}),
    ...(brandFilter ? { brandId: brandFilter } : {}),
  };
  const leadRelBranchWhere = {
    lead: {
      ...(branchScope ? { branchId: { in: branchScope } } : {}),
      ...(brandFilter ? { brandId: brandFilter } : {}),
    },
  };

  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const d7 = new Date(now.getTime() - 7 * DAY);
  const d90 = new Date(now.getTime() - 90 * DAY);
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    active, dueToday, byTemp, byStage, openBreaches, poolWaitingRows, conflicts, recentEvents,
    pendingEscalations, staleHotLeads, poolAllWaiting,
    salespeople, activeLeads, activities7d, bookingsMonth, cohort90, channelCohort,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: "active", ...leadBranchWhere } }),
    prisma.lead.count({ where: { status: "active", nextActionAt: { lte: endOfToday }, ...leadBranchWhere } }),
    prisma.lead.groupBy({ by: ["temperature"], where: { status: "active", ...leadBranchWhere }, _count: true }),
    prisma.lead.groupBy({ by: ["stage"], where: { status: "active", ...leadBranchWhere }, _count: true }),
    prisma.slaEvent.count({ where: { resolvedAt: null, ...leadRelBranchWhere } }),
    // LeadPool has no Prisma relation to Lead (raw-SQL schema, mirrored as-is)
    // — branch-scoping it needs a manual join, done below after this fetch.
    prisma.leadPool.findMany({ where: { claimedAt: null }, orderBy: { enteredAt: "asc" } }),
    prisma.lead.count({ where: { status: "active", temperatureConflict: 1, ...leadBranchWhere } }),
    prisma.slaEvent.findMany({
      where: leadRelBranchWhere,
      orderBy: { eventId: "desc" }, take: 10,
      include: { lead: { include: { person: true, brand: true } } },
    }),
    // ── Action Zone ─────────────────────────────────────────────────────
    prisma.slaEvent.findMany({
      where: { eventType: "idle_escalate", resolvedAt: null, ...leadRelBranchWhere },
      orderBy: { detectedAt: "asc" }, take: 8,
      include: { lead: { include: { person: true, brand: true } } },
    }),
    prisma.lead.findMany({
      where: { status: "active", temperature: "hot", lastActivityAt: { lt: d7 }, ...leadBranchWhere },
      orderBy: { lastActivityAt: "asc" }, take: 5,
      include: { person: true, brand: true },
    }),
    prisma.lead.findMany({ where: leadBranchWhere, select: { leadId: true } }),
    // ── Scorecard raw data (aggregated in JS — team sizes are small) ─────
    // Branch AND brand eligibility both checked in JS below via branchLinks
    // (fun_user_branch) + home branchId — a Prisma where on branchId alone
    // would miss reps who only reach a branch through branchLinks, the same
    // gap already fixed for reassign-candidate lists elsewhere in the app.
    prisma.funUser.findMany({ where: { isActive: 1, role: "sales" }, include: { branchLinks: true } }),
    prisma.lead.findMany({
      where: { status: "active", ownerUserId: { not: null }, ...leadBranchWhere },
      select: { ownerUserId: true, nextActionAt: true, createdAt: true, firstResponseAt: true },
    }),
    prisma.activity.groupBy({
      by: ["createdBy"],
      where: { createdAt: { gte: d7 }, createdBy: { not: null }, direction: { in: ["outbound", "internal"] } },
      _count: true,
    }),
    prisma.leadStageHistory.findMany({
      where: { toStage: "booking", changedAt: { gte: startMonth }, ...leadRelBranchWhere },
      include: { lead: { select: { ownerUserId: true } } },
    }),
    prisma.lead.findMany({
      where: { createdAt: { gte: d90 }, ownerUserId: { not: null }, ...leadBranchWhere },
      select: { ownerUserId: true, stage: true, createdAt: true, firstResponseAt: true },
    }),
    // ── Channel performance (user req 2026-07-15) — 90-day window, same as
    // the scorecard cohort, for enough volume to not be noise.
    prisma.lead.findMany({
      where: { createdAt: { gte: d90 }, ...leadBranchWhere },
      select: { stage: true, channel: { select: { category: true } } },
    }),
  ]);

  // Manual branch-scope join for the pool (see comment above) — a branch-
  // scoped manager only counts/sees pool leads that were actually in their
  // own branches before they got forfeited.
  const scopedPoolLeadIds = new Set(poolAllWaiting.map((l) => Number(l.leadId)));
  const poolWaiting = branchScope ? poolWaitingRows.filter((p) => scopedPoolLeadIds.has(Number(p.leadId))) : poolWaitingRows;
  const oldestPool = poolWaiting[0] ?? null;

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
  // Branch-scope BEFORE taking top 5 / counting the total — otherwise a
  // manager's badge count and list would include other branches' chats too
  // (same class of bug just fixed for staleHot/pool/SLA events above).
  const unansweredScopedLeads = unansweredChats.length ? await prisma.lead.findMany({
    where: { leadId: { in: unansweredChats.map((u) => BigInt(u.leadId)) }, ...leadBranchWhere },
    include: { person: true, brand: true },
  }) : [];
  const scopedUnansweredLeadIds = new Set(unansweredScopedLeads.map((l) => Number(l.leadId)));
  const unansweredChatsScoped = unansweredChats.filter((u) => scopedUnansweredLeadIds.has(u.leadId));
  const unansweredDetail = unansweredScopedLeads
    .sort((a, b) => Number(a.leadId) - Number(b.leadId)) // stable order, waitingSince applied below
    .filter((l) => unansweredChatsScoped.some((u) => u.leadId === Number(l.leadId)))
    .slice(0, 5);
  const ownerIds = [...new Set(unansweredDetail.map((l) => l.ownerUserId).filter((x): x is number => x !== null))];
  const ownersForChats = ownerIds.length ? await prisma.funUser.findMany({ where: { userId: { in: ownerIds } } }) : [];
  const ownerName = new Map(ownersForChats.map((u) => [u.userId, u.nickname || u.displayName]));

  // Brand-eligible reps only (when a brand filter is active) — same
  // branchLinks-or-home-branch rule used for reassign candidates elsewhere.
  const brandBranchIds = brandFilter
    ? new Set((await prisma.branch.findMany({ where: { brandId: brandFilter }, select: { branchId: true } })).map((b) => b.branchId))
    : null;
  const scopedSalespeople = brandBranchIds
    ? salespeople.filter((sp) => {
        const ids = [...sp.branchLinks.map((l) => l.branchId), ...(sp.branchId !== null ? [sp.branchId] : [])];
        return ids.some((id) => brandBranchIds.has(id));
      })
    : salespeople;

  // ── scorecard assembly ─────────────────────────────────────────────────
  const scorecard = scopedSalespeople.map((sp) => {
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

  // ── Channel performance best/worst (user req 2026-07-15) ────────────────
  // Minimum sample size so a channel with 1-2 leads can't show a misleading
  // 0%/100% rate — needs at least this many leads in the 90-day window to
  // be eligible at all.
  const CONVERTED_STAGES = new Set(["booking", "contract", "delivered", "won"]);
  const MIN_CHANNEL_SAMPLE = 5;
  const channelStats = new Map<string, { leads: number; booked: number }>();
  for (const l of channelCohort) {
    const cat = l.channel.category;
    const cur = channelStats.get(cat) ?? { leads: 0, booked: 0 };
    cur.leads++;
    if (CONVERTED_STAGES.has(l.stage)) cur.booked++;
    channelStats.set(cat, cur);
  }
  const eligibleChannels = [...channelStats.entries()]
    .filter(([, v]) => v.leads >= MIN_CHANNEL_SAMPLE)
    .map(([category, v]) => ({ category, leads: v.leads, booked: v.booked, rate: v.booked / v.leads }))
    .sort((a, b) => b.rate - a.rate);
  const channelPerformance = {
    best: eligibleChannels[0] ?? null,
    worst: eligibleChannels.length > 1 ? eligibleChannels[eligibleChannels.length - 1] : null,
    sampleDays: 90,
    minSample: MIN_CHANNEL_SAMPLE,
  };

  return NextResponse.json({
    brandId: brandFilter,
    channelPerformance,
    active, dueToday, openBreaches, poolWaiting: poolWaiting.length, conflicts,
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
      pool: { waiting: poolWaiting.length, oldestDays: daysAgo(oldestPool?.enteredAt ?? null) },
      unansweredChats: unansweredDetail.map((l) => {
        const u = unansweredChatsScoped.find((x) => x.leadId === Number(l.leadId));
        return {
          leadId: Number(l.leadId),
          customerName: custName(l),
          brand: l.brand.brandName,
          ownerName: l.ownerUserId ? ownerName.get(l.ownerUserId) ?? null : null,
          hoursWaiting: u?.waitingSince ? Math.round((now.getTime() - u.waitingSince.getTime()) / 3600000) : null,
        };
      }),
      unansweredTotal: unansweredChatsScoped.length,
    },
    scorecard,
  });
}
