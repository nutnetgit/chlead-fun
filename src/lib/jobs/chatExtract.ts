import { prisma } from "@/lib/prisma";
import { callGeminiJson, parseModelJson, geminiReady, geminiModel } from "@/lib/gemini";
import { isAutomationJobEnabled } from "@/lib/settings";
import { resolveTemperature } from "@/lib/jobs/score";
import type { BuyTimeframe, PaymentType } from "@prisma/client";

/**
 * Hourly chat-extract (user req 2026-07-15 — "auto-tag จากบทสนทนา"). The
 * nightly score job only ever scores a lead ONCE (aiScore=null filter) using
 * the intake-form message — everything the customer says in LINE chat after
 * that was invisible to the AI. This job closes that gap: for every active
 * lead with inbound chat newer than its chat_analyzed_at watermark, Gemini
 * reads the recent transcript and returns
 *   (a) a fresh 0-100 score → temperature via the SAME ADR-011 conflict rules
 *       as the nightly job (resolveTemperature — human settings are never
 *       silently overridden, >1-tier disagreement forces WARM + badge), and
 *   (b) structured facts (รุ่น/สี/งบ/ผ่อน-สด/เทิร์น/ระยะเวลาซื้อ) that FILL
 *       BLANK FIELDS ONLY — a value a human already entered is never touched
 *       (user decision 2026-07-15: auto-fill, no confirmation step, no field
 *       exceptions).
 *
 * Deliberately writes NO fun_activity row: the trg_activity_touch_lead DB
 * trigger bumps last_activity_at on every activity insert, which would reset
 * the SLA idle clock — hiding exactly the "customer is chatting but sales
 * has gone quiet" case the SLA engine exists to catch. Visibility comes
 * through ai_score_reason instead (prefixed "จากแชท:", shown on lead cards).
 *
 * Rides the "score" toggle in /settings/automation (enabled-only, hour
 * ignored — see isAutomationJobEnabled). PDPA: phone-number-shaped strings
 * are redacted from the transcript before it leaves for Gemini, same
 * no-direct-PII rule as the score/nudge prompts.
 */

const TRANSCRIPT_MESSAGES = 10;
const BATCH_LEADS = 20;

// "0812345678" / "081-234-5678" / "081 234 5678" → "[เบอร์]"
const redactPhones = (s: string) => s.replace(/0[\s-]?\d(?:[\s-]?\d){7,8}/g, "[เบอร์]");

// Gemini answers with the DB-side timeframe strings; Prisma's enum members
// for two of them differ from the stored values (m1_3 ↔ "1_3m", m3_6 ↔
// "3_6m") — map explicitly, never trust the model string as a member name.
const TIMEFRAME_MAP: Record<string, BuyTimeframe> = {
  within_1m: "within_1m", "1_3m": "m1_3", "3_6m": "m3_6", over_6m: "over_6m",
};

type ExtractRow = {
  lead_id: number;
  score: number;
  reason?: string;
  timeframe?: string | null;
  payment?: string | null;
  tradein?: boolean | null;
  variant?: string | null;
  color?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
};

export async function runChatExtractJob() {
  const gate = await isAutomationJobEnabled("score");
  if (!gate.active) return { ok: true, skipped: true, reason: gate.reason };

  // Leads with inbound chat newer than the watermark. Prisma can't compare
  // two columns in a where clause, so this one lookup is raw SQL.
  const candidates = await prisma.$queryRaw<{ lead_id: bigint }[]>`
    SELECT DISTINCT l.lead_id FROM fun_lead l
    JOIN fun_chat_message m ON m.lead_id = l.lead_id AND m.direction = 'inbound'
    WHERE l.status = 'active'
      AND (l.chat_analyzed_at IS NULL OR m.created_at > l.chat_analyzed_at)
    LIMIT ${BATCH_LEADS}`;
  if (candidates.length === 0) return { ok: true, analyzed: 0, note: "no new inbound chat" };
  if (!geminiReady()) return { ok: false, error: "GEMINI_API_KEY not set", pending: candidates.length };

  const leads = await prisma.lead.findMany({
    where: { leadId: { in: candidates.map((c) => c.lead_id) } },
    include: { person: true, brand: true },
  });

  // Latest N messages per lead (both directions — the salesperson's replies
  // are context the model needs to judge where the deal stands).
  const transcripts = new Map<string, { who: string; text: string }[]>();
  const watermark = new Map<string, Date>();
  for (const lead of leads) {
    const msgs = await prisma.chatMessage.findMany({
      where: { leadId: lead.leadId, body: { not: null } },
      orderBy: { createdAt: "desc" },
      take: TRANSCRIPT_MESSAGES,
    });
    if (msgs.length === 0) continue;
    watermark.set(String(lead.leadId), msgs[0].createdAt ?? new Date());
    transcripts.set(String(lead.leadId), msgs.reverse().map((m) => ({
      who: m.direction === "inbound" ? "ลูกค้า" : "เซลส์",
      text: redactPhones((m.body ?? "").slice(0, 300)),
    })));
  }

  const rows = leads
    .filter((l) => transcripts.has(String(l.leadId)))
    .map((l) => ({
      lead_id: Number(l.leadId),
      brand: l.brand.brandName,
      name: l.person.nickname || l.person.firstName || "ลูกค้า",
      current_model: l.interestedVariant ?? "",
      chat: transcripts.get(String(l.leadId)),
    }));
  if (rows.length === 0) return { ok: true, analyzed: 0, note: "no transcript bodies" };

  const prompt =
    "คุณคือผู้ช่วยวิเคราะห์บทสนทนา LINE ระหว่างลูกค้ากับเซลส์รถยนต์ ต่อ lead ให้ตอบ 2 ส่วน: " +
    "(1) score 0-100 โอกาสซื้อจากบทสนทนาล่าสุด (70-100=พร้อมซื้อ/นัดแล้ว/คุยราคาจริงจัง, 35-69=สนใจแต่ยังไม่ชัด, 0-34=เงียบ/ถามเล่น) พร้อม reason สั้นๆ ไม่เกิน 12 คำ. " +
    "(2) ข้อมูลที่ลูกค้าพูดถึงชัดเจนเท่านั้น (ไม่แน่ใจให้ null): " +
    "timeframe หนึ่งใน within_1m|1_3m|3_6m|over_6m, payment หนึ่งใน cash|finance, " +
    "tradein true ถ้าพูดถึงรถเทิร์น/รถเก่าแลก, variant ชื่อรุ่น/ตัวถังที่สนใจ, color สีที่สนใจ, " +
    "budget_min/budget_max งบเป็นตัวเลขบาท (พูดถึงค่างวดรายเดือนอย่าใส่เป็นงบ). " +
    'ตอบเป็น JSON array เท่านั้น: [{"lead_id":number,"score":number,"reason":"...","timeframe":null,"payment":null,"tradein":null,"variant":null,"color":null,"budget_min":null,"budget_max":null}]\n\n' +
    "Lead:\n" + JSON.stringify(rows);

  let parsed: ExtractRow[];
  try {
    parsed = parseModelJson(await callGeminiJson(prompt));
    if (!Array.isArray(parsed)) throw new Error("expected array");
  } catch (e) {
    return { ok: false, error: `gemini: ${String(e).slice(0, 160)}` };
  }

  let analyzed = 0, conflicts = 0, fieldsFilled = 0;
  for (const p of parsed) {
    const lead = leads.find((l) => Number(l.leadId) === p.lead_id);
    const mark = lead ? watermark.get(String(lead.leadId)) : undefined;
    if (!lead || !mark) continue;
    const score = Math.max(0, Math.min(100, Math.round(Number(p.score))));
    if (!Number.isFinite(score)) continue;

    const { temperature, conflict } = resolveTemperature(lead.temperature, score);
    if (conflict) conflicts++;

    const data: Record<string, unknown> = {
      aiScore: score,
      aiScoreReason: `จากแชท: ${p.reason ?? ""}`.slice(0, 255),
      temperature,
      temperatureConflict: conflict ? 1 : 0,
      chatAnalyzedAt: mark,
    };

    // Fill-blank-only — a human-entered value is never overwritten. The
    // enum defaults ('undecided'/'unknown'/tradein 0) count as blank; a
    // tradein can only ever flip 0→1 here (mentioning a trade-in is a real
    // signal; its absence proves nothing, so never 1→0).
    if (!lead.interestedVariant && p.variant) { data.interestedVariant = String(p.variant).slice(0, 100); fieldsFilled++; }
    if (!lead.interestedColor && p.color) { data.interestedColor = String(p.color).slice(0, 50); fieldsFilled++; }
    if ((lead.paymentType ?? "undecided") === "undecided" && (p.payment === "cash" || p.payment === "finance")) {
      data.paymentType = p.payment as PaymentType; fieldsFilled++;
    }
    if ((lead.buyTimeframe ?? "unknown") === "unknown" && p.timeframe && TIMEFRAME_MAP[p.timeframe]) {
      data.buyTimeframe = TIMEFRAME_MAP[p.timeframe]; fieldsFilled++;
    }
    if (!lead.hasTradein && p.tradein === true) { data.hasTradein = 1; fieldsFilled++; }
    const bMin = Number(p.budget_min), bMax = Number(p.budget_max);
    if (lead.budgetMin === null && lead.budgetMax === null &&
        Number.isFinite(bMin) && Number.isFinite(bMax) && bMin > 0 && bMin <= bMax) {
      data.budgetMin = bMin; data.budgetMax = bMax; fieldsFilled++;
    }

    await prisma.lead.update({ where: { leadId: lead.leadId }, data });
    analyzed++;
  }

  return { ok: true, analyzed, conflicts, fieldsFilled, batch: rows.length, model: geminiModel() };
}
