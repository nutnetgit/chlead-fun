import type { ChannelCategory, Temperature } from "@prisma/client";

export type SlaRuleLike = {
  ruleId: number;
  scopeBrandId: number | null;
  scopeBranchId: number | null;
  applyTemperature: string; // 'hot'|'warm'|'cold'|'any'
  applyChannelCategory: string | null;
  firstResponseMinutes: number | null;
  followupIntervalDays: number | null;
  idleNudgeDays: number | null;
  idleEscalateDays: number | null;
  idleForfeitDays: number | null;
};

export type MatchInput = {
  brandId: number;
  branchId: number;
  temperature: Temperature | null;
  channelCategory: ChannelCategory;
};

/**
 * Pick the most specific active fun_sla_rule for a lead. Specificity order
 * (highest wins): branch-scoped > brand-scoped > channel-category-specific
 * (handoff §5: OEM/Online has its own stricter SLA, independent of
 * temperature) > temperature-specific over 'any'. Ties broken by rule_id asc
 * (first seeded wins) — deterministic, no hidden randomness.
 */
export function matchSlaRule(rules: SlaRuleLike[], input: MatchInput): SlaRuleLike | null {
  const temp = input.temperature ?? "cold"; // no human/AI temperature yet → treat as cold (loosest urgency) until scored
  let best: SlaRuleLike | null = null;
  let bestScore = -1;

  for (const r of rules) {
    if (r.scopeBrandId !== null && r.scopeBrandId !== input.brandId) continue;
    if (r.scopeBranchId !== null && r.scopeBranchId !== input.branchId) continue;
    if (r.applyChannelCategory && r.applyChannelCategory !== input.channelCategory) continue;
    if (r.applyTemperature !== "any" && r.applyTemperature !== temp) continue;

    const score =
      (r.scopeBranchId !== null ? 8 : 0) +
      (r.scopeBrandId !== null ? 4 : 0) +
      (r.applyChannelCategory ? 2 : 0) +
      (r.applyTemperature !== "any" ? 1 : 0);

    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}
