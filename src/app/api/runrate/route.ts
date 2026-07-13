import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting, getConversionRateConfig } from "@/lib/settings";
import { requireRole } from "@/lib/authz";

export const runtime = "nodejs";

/**
 * Run Rate v2 (user decisions 2026-07-08):
 *   - COUNT-based only ("จองได้ = จบเคส") — no money until FB cost-per-lead
 *     data exists after the Meta connection.
 *   - Month-by-month with CARRY-OVER: beat this month's target and the
 *     surplus rolls into next month ("ทำได้เยอะเดือนนี้ ยกไปเดือนหน้า ก็สบาย").
 *     A deficit rolls forward too.
 *   - For SALES as well as managers: ?owner=<userId> scopes everything to one
 *     salesperson (their bookings, their leads, their per-user target).
 *   - Core question answered: how many MORE leads must be found in the rest
 *     of this month to hit the remaining booking target at the current
 *     conversion rate, vs how many leads are expected to arrive anyway.
 * Config in fun_settings runrate_config: { teamMonthlyTarget, perUser: {id: n} }.
 */
const DAY = 24 * 60 * 60 * 1000;
const CONVERTED_STAGES = ["booking", "contract", "delivered", "won"] as const;

type Cfg = { teamMonthlyTarget?: number; perUser?: Record<string, number> };

export async function GET(request: NextRequest) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  // sales role is forced to their own scope regardless of the query param
  // (user req 2026-07-08 — same reasoning as GET /api/leads).
  const owner = rq.role === "sales" ? String(rq.funUserId) : request.nextUrl.searchParams.get("owner");
  const ownerId = owner ? Number(owner) : null;

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthIdx = now.getMonth(); // 0-based
  const monthStart = new Date(now.getFullYear(), monthIdx, 1);
  const daysInMonth = new Date(now.getFullYear(), monthIdx + 1, 0).getDate();
  const daysElapsed = Math.max(1, (now.getTime() - monthStart.getTime()) / DAY);
  const daysLeft = Math.max(0, daysInMonth - Math.floor(daysElapsed));
  const windowStart = new Date(now.getTime() - 90 * DAY);

  const cfg = ((await getSetting<Cfg>("runrate_config")) ?? {}) as Cfg;
  const target = ownerId
    ? Number(cfg.perUser?.[String(ownerId)]) || null
    : Number(cfg.teamMonthlyTarget) || null;

  // Bookings this year via stage history (first time a lead hit 'booking').
  const bookingEvents = await prisma.leadStageHistory.findMany({
    where: { toStage: "booking", changedAt: { gte: yearStart } },
    include: { lead: { select: { ownerUserId: true } } },
  });
  const scoped = bookingEvents.filter((e) => !ownerId || e.lead.ownerUserId === ownerId);
  const byMonth: number[] = Array.from({ length: 12 }, () => 0);
  const seen = new Set<string>();
  for (const e of scoped) {
    const key = String(e.leadId);
    if (seen.has(key)) continue; // count each lead's first booking only
    seen.add(key);
    if (e.changedAt) byMonth[e.changedAt.getMonth()]++;
  }
  const actualThisMonth = byMonth[monthIdx];

  // Carry-over = cumulative(actual) - cumulative(target), counted from the
  // first month that actually has bookings (months before the system went
  // live must not show up as a fake deficit).
  const firstActiveMonth = byMonth.findIndex((v) => v > 0);
  const carryStart = firstActiveMonth === -1 ? monthIdx : firstActiveMonth;
  let carryIn = 0;
  if (target) {
    for (let m = carryStart; m < monthIdx; m++) carryIn += byMonth[m] - target;
  }
  const neededThisMonth = target ? Math.max(0, target - carryIn - actualThisMonth) : null;

  // Lead flow + conversion (90-day cohort, count-based).
  const cohort = await prisma.lead.findMany({
    where: { createdAt: { gte: windowStart }, ...(ownerId ? { ownerUserId: ownerId } : {}) },
    select: { stage: true, createdAt: true },
  });
  const cohortConverted = cohort.filter((l) => (CONVERTED_STAGES as readonly string[]).includes(l.stage)).length;
  const cr = cohort.length ? cohortConverted / cohort.length : 0;

  const leadsToDate = cohort.filter((l) => l.createdAt && l.createdAt >= monthStart).length;
  const dailyLeadRate = leadsToDate / daysElapsed;
  const expectedRestLeads = Math.round(dailyLeadRate * daysLeft);
  const projectedMonthLeads = Math.round(dailyLeadRate * daysInMonth * 10) / 10;
  const projectedBookings = Math.round((actualThisMonth + expectedRestLeads * cr) * 10) / 10;

  // Weighted Pipeline forecast (user req 2026-07-11, /settings/conversion-rates):
  // Σ(open leads in tier × tier's close probability) — a second, independent
  // forecast alongside the 90-day-CR one above, using the manager-set
  // probabilities instead of historical conversion rate.
  const rates = await getConversionRateConfig();
  const byTemp = await prisma.lead.groupBy({
    by: ["temperature"],
    where: { status: "active", ...(ownerId ? { ownerUserId: ownerId } : {}) },
    _count: true,
  });
  const tempCount = { hot: 0, warm: 0, cold: 0 };
  for (const t of byTemp) if (t.temperature && t.temperature in tempCount) tempCount[t.temperature] += t._count;
  const weightedPipeline = {
    hot: { count: tempCount.hot, probabilityPct: rates.hotProbabilityPct, expected: Math.round(tempCount.hot * (rates.hotProbabilityPct / 100) * 10) / 10 },
    warm: { count: tempCount.warm, probabilityPct: rates.warmProbabilityPct, expected: Math.round(tempCount.warm * (rates.warmProbabilityPct / 100) * 10) / 10 },
    cold: { count: tempCount.cold, probabilityPct: rates.coldProbabilityPct, expected: Math.round(tempCount.cold * (rates.coldProbabilityPct / 100) * 10) / 10 },
  };
  const weightedExpectedTotal = Math.round((weightedPipeline.hot.expected + weightedPipeline.warm.expected + weightedPipeline.cold.expected) * 10) / 10;

  // The headline: leads still required vs leads expected to arrive anyway.
  let needLeads = null;
  if (neededThisMonth !== null) {
    const requiredLeads = cr > 0 ? Math.ceil(neededThisMonth / cr) : null;
    needLeads = {
      requiredLeads,
      expectedRestLeads,
      gapMoreLeads: requiredLeads !== null ? Math.max(0, requiredLeads - expectedRestLeads) : null,
    };
  }

  return NextResponse.json({
    scope: ownerId ? "user" : "team",
    config: { target, teamMonthlyTarget: Number(cfg.teamMonthlyTarget) || null, perUser: cfg.perUser ?? {} },
    month: {
      name: monthIdx + 1, daysElapsed: Math.floor(daysElapsed), daysLeft, daysInMonth,
      actualBookings: actualThisMonth, target, carryIn, neededThisMonth,
    },
    leads: { toDate: leadsToDate, projected: projectedMonthLeads, expectedRest: expectedRestLeads },
    conversion: { windowDays: 90, cohortLeads: cohort.length, cohortConverted, rate: cr },
    weightedPipeline: { ...weightedPipeline, total: weightedExpectedTotal },
    forecast: { projectedBookings, onTrack: neededThisMonth !== null ? projectedBookings + carryIn + 0 >= (target ?? 0) - 0 && actualThisMonth + expectedRestLeads * cr + carryIn >= (target ?? 0) : null },
    monthsTable: byMonth.slice(carryStart, monthIdx + 1).map((v, i) => {
      const m = carryStart + i;
      return {
        month: m + 1, actual: v, target,
        carry: target ? byMonth.slice(carryStart, m + 1).reduce((s, x) => s + x, 0) - target * (m - carryStart + 1) : null,
      };
    }),
    note: "ยังไม่ใช้ตัวเงิน — เมื่อเชื่อม Meta ได้จะดึงค่าโฆษณาต่อ Lead มาคำนวณ cost-per-booking ต่อ",
  });
}

// Save targets: { teamMonthlyTarget?, perUser?: {userId: n} }
export async function PUT(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Cfg;
  const cfg: Cfg = {
    teamMonthlyTarget: Number(b.teamMonthlyTarget) > 0 ? Number(b.teamMonthlyTarget) : undefined,
    perUser: typeof b.perUser === "object" && b.perUser ? Object.fromEntries(
      Object.entries(b.perUser).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]),
    ) : {},
  };
  await setSetting("runrate_config", cfg);
  return NextResponse.json({ ok: true });
}
