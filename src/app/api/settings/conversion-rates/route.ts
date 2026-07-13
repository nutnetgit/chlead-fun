import { NextRequest, NextResponse } from "next/server";
import { setSetting, getConversionRateConfig, type ConversionRateConfig } from "@/lib/settings";
import { requireRole } from "@/lib/authz";

/**
 * Weighted Pipeline / Lead Aging assumptions (user req 2026-07-11) — the
 * configurable knobs behind the Run Rate forecast:
 *   forecast_value = Σ(open leads in tier × tier's close probability)
 * plus the aging threshold that auto-downgrades a HOT lead that's gone stale
 * (temperature alone doesn't decay with time today — a lead scored HOT on
 * day 1 stays HOT forever unless a human changes it or the AI conflict rule
 * kicks in). hotAgingDays is read by runSlaJob (src/lib/jobs/sla.ts) every
 * hourly pass; the probabilities are read by GET /api/runrate for the
 * weighted forecast.
 */
export async function GET() {
  return NextResponse.json(await getConversionRateConfig());
}

export async function PUT(request: NextRequest) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Partial<ConversionRateConfig>;
  const current = await getConversionRateConfig();
  const clampPct = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : fallback);
  const next: ConversionRateConfig = {
    hotProbabilityPct: clampPct(b.hotProbabilityPct, current.hotProbabilityPct),
    warmProbabilityPct: clampPct(b.warmProbabilityPct, current.warmProbabilityPct),
    coldProbabilityPct: clampPct(b.coldProbabilityPct, current.coldProbabilityPct),
    hotAgingDays: typeof b.hotAgingDays === "number" && b.hotAgingDays > 0 ? Math.round(b.hotAgingDays) : current.hotAgingDays,
  };
  await setSetting("conversionRates", next);
  return NextResponse.json({ ok: true, config: next });
}
