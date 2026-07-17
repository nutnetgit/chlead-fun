import { prisma } from "@/lib/prisma";
import { callGeminiJson, parseModelJson, geminiReady, geminiModel } from "@/lib/gemini";
import { isAutomationJobActive } from "@/lib/settings";
import type { Temperature } from "@prisma/client";

/**
 * Nightly AI scoring (in-app cron or manual POST /api/jobs/score). Fills
 * fun_lead.ai_score (0-100) + ai_score_reason. No PII sent: prompt carries
 * model interest + the latest inbound message only (§PDPA). Idle/dormant
 * transitions are the SLA engine's job, not this one's.
 *
 * ADR-011 (temperature vs ai_score conflict):
 *   - No human temperature set yet → AI's tier becomes the temperature outright.
 *   - Human temperature set → map ai_score to a tier (70-100 hot / 35-69 warm /
 *     0-34 cold) and compare distance to the human's setting:
 *       distance <= 1 tier (e.g. hot vs warm) → leave the human's value alone.
 *       distance  > 1 tier (hot vs cold)      → FORCE temperature to 'warm' +
 *         set temperature_conflict=1 so every lead card can show the badge.
 *     A lead that's no longer conflicting has the flag cleared automatically.
 */
const DAY = 24 * 60 * 60 * 1000;

export function scoreTier(score: number): Temperature {
  if (score >= 70) return "hot";
  if (score >= 35) return "warm";
  return "cold";
}

const TIER_RANK: Record<Temperature, number> = { cold: 0, warm: 1, hot: 2 };

// ADR-011 in one place — shared with the hourly chat-extract job
// (src/lib/jobs/chatExtract.ts) so both scoring paths resolve temperature
// vs ai_score conflicts with byte-identical rules.
export function resolveTemperature(current: Temperature | null, score: number): { temperature: Temperature; conflict: boolean } {
  const aiTier = scoreTier(score);
  if (current === null) return { temperature: aiTier, conflict: false };
  const distance = Math.abs(TIER_RANK[aiTier] - TIER_RANK[current]);
  if (distance > 1) return { temperature: "warm", conflict: true };
  return { temperature: current, conflict: false };
}

export async function runScoreJob() {
  const gate = await isAutomationJobActive("score");
  if (!gate.active) return { ok: true, skipped: true, reason: gate.reason };

  const leads = await prisma.lead.findMany({
    where: { aiScore: null, status: "active" },
    orderBy: { createdAt: "asc" },
    take: 30,
    include: {
      brand: true,
      channel: true,
      activities: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (leads.length === 0) return { ok: true, scored: 0, note: "no leads to score" };
  if (!geminiReady()) return { ok: false, error: "GEMINI_API_KEY not set", pending: leads.length };

  const now = Date.now();
  const rows = leads.map((l) => ({
    lead_id: Number(l.leadId),
    brand: l.brand.brandName,
    channel: l.channel.channelName,
    model_interest: l.interestedVariant ?? "",
    days_old: Math.floor((now - (l.createdAt?.getTime() ?? now)) / DAY),
    message: (l.activities[0]?.detail ?? l.activities[0]?.summary ?? "").slice(0, 300),
  }));

  const prompt =
    "คุณคือผู้ช่วยประเมินคุณภาพ Lead ของดีลเลอร์รถยนต์ ให้คะแนน 0-100 (สูง=โอกาสซื้อสูง) " +
    "โดยดูจากรุ่นที่สนใจ ช่องทาง ข้อความ และความสด (days_old น้อย = สดกว่า). " +
    "70-100=พร้อมซื้อ/งบชัด/สนใจรุ่นเจาะจง, 35-69=สนใจแต่ยังไม่ชัด, 0-34=ข้อมูลน้อย/ถามเล่น. " +
    'ตอบเป็น JSON array เท่านั้น: [{"lead_id":number,"score":number,"reason":"เหตุผลสั้นๆภาษาไทยไม่เกิน 12 คำ"}]\n\n' +
    "Lead:\n" + JSON.stringify(rows);

  let parsed: Array<{ lead_id: number; score: number; reason?: string }>;
  try {
    parsed = parseModelJson(await callGeminiJson(prompt));
    if (!Array.isArray(parsed)) throw new Error("expected array");
  } catch (e) {
    return { ok: false, error: `gemini: ${String(e).slice(0, 160)}` };
  }

  let scored = 0;
  let conflicts = 0;
  for (const p of parsed) {
    const lead = leads.find((l) => Number(l.leadId) === p.lead_id);
    if (!lead) continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(p.score))));
    if (!Number.isFinite(score)) continue;
    const { temperature, conflict } = resolveTemperature(lead.temperature, score);
    if (conflict) conflicts++;

    await prisma.lead.update({
      where: { leadId: lead.leadId },
      data: {
        aiScore: score,
        aiScoreReason: (p.reason ?? "").slice(0, 255),
        temperature,
        temperatureConflict: conflict ? 1 : 0,
      },
    });
    scored++;
  }

  return { ok: true, scored, conflicts, batch: leads.length, model: geminiModel() };
}
