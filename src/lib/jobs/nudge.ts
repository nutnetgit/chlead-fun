import { prisma } from "@/lib/prisma";
import { callGeminiJson, parseModelJson, geminiReady, geminiModel } from "@/lib/gemini";
import { linePush, buildNudgeBubble } from "@/lib/flex";
import { isAutomationJobActive } from "@/lib/settings";

/**
 * Morning nudge (in-app cron or manual POST /api/jobs/nudge). For every active
 * lead whose next_action_at is due, Gemini drafts a polite Thai follow-up which
 * we push to the mapped sales LINE group as copyable text + an action card, and
 * log to fun_nudge_log (trigger_type=followup_due). The salesperson copies and
 * sends it themselves — AI never messages the customer (hard company rule).
 *
 * Notes:
 *  - No fun_activity row is written here: the DB trigger would bump
 *    last_activity_at and reset the idle clock — an AI nudge is not human work.
 *  - next_action_at is pushed +3 days so the same lead isn't re-nudged daily
 *    until WF4 postbacks take over scheduling.
 */
export async function runNudgeJob() {
  const gate = await isAutomationJobActive("nudge");
  if (!gate.active) return { ok: true, skipped: true, reason: gate.reason };

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const leads = await prisma.lead.findMany({
    where: {
      status: "active",
      stage: { notIn: ["booking", "contract", "delivered", "won", "lost"] },
      nextActionAt: { lte: endOfToday },
    },
    take: 60,
    include: {
      person: true,
      brand: true,
      branch: true,
      activities: { where: { direction: "inbound" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (leads.length === 0) return { ok: true, nudged: 0, note: "none due today" };
  if (!geminiReady()) return { ok: false, error: "GEMINI_API_KEY not set", due: leads.length };

  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!lineToken) return { ok: false, error: "LINE token not set", due: leads.length };

  // Destination group per lead via fun_channel_config (brand string + branch code).
  const configs = await prisma.channelConfig.findMany({ where: { active: 1 } });
  const groupFor = (brandName: string, branchCode: string | null) => {
    const b = brandName.toLowerCase();
    return (
      configs.find((c) => c.brand.toLowerCase() === b && c.branchCode === branchCode)?.lineGroupId ??
      configs.find((c) => c.brand.toLowerCase() === b)?.lineGroupId ??
      null
    );
  };

  // One batched Gemini call. No phone/citizen data in the prompt (PDPA).
  const rows = leads.map((l) => ({
    lead_id: Number(l.leadId),
    name: l.person.nickname || l.person.firstName || "ลูกค้า",
    model: l.interestedVariant ?? "",
    temperature: l.temperature ?? "",
    last_message: (l.activities[0]?.detail ?? "").slice(0, 200),
  }));
  const prompt =
    "คุณคือผู้ช่วยเซลส์รถยนต์ ช่วยร่างข้อความ follow-up ภาษาไทยที่สุภาพ เป็นกันเอง ไม่กดดัน " +
    "ไม่เกิน 3 ประโยค อ้างถึงรุ่นที่ลูกค้าสนใจถ้ามี ชวนคุยต่อ/นัดดูรถ ลงท้ายเปิดโอกาสให้ตอบกลับ. " +
    "ห้ามใส่ชื่อเซลส์หรือเบอร์. " +
    'ตอบเป็น JSON array เท่านั้น: [{"lead_id":number,"draft":"ข้อความ"}]\n\nลูกค้า:\n' +
    JSON.stringify(rows);

  let drafts: Array<{ lead_id: number; draft: string }>;
  try {
    drafts = parseModelJson(await callGeminiJson(prompt));
    if (!Array.isArray(drafts)) throw new Error("expected array");
  } catch (e) {
    return { ok: false, error: `gemini: ${String(e).slice(0, 160)}` };
  }
  const draftFor = new Map(drafts.map((d) => [d.lead_id, d.draft]));

  let nudged = 0;
  const skipped: string[] = [];
  for (const lead of leads) {
    const idNum = Number(lead.leadId);
    const draft = draftFor.get(idNum);
    const group = groupFor(lead.brand.brandName, lead.branch.branchCode ?? lead.branch.branchName);
    if (!draft || !group) { skipped.push(`${idNum}:${!draft ? "no_draft" : "no_group"}`); continue; }

    const { altText, contents } = buildNudgeBubble({
      leadId: idNum,
      brand: lead.brand.brandName,
      branchCode: lead.branch.branchCode ?? lead.branch.branchName,
      customerName: lead.person.nickname || lead.person.firstName,
      modelInterest: lead.interestedVariant,
      score: lead.temperature,
    });
    const push = await linePush(lineToken, group, [
      { type: "text", text: draft },
      { type: "flex", altText, contents },
    ]);

    await prisma.nudgeLog.create({
      data: {
        leadId: lead.leadId,
        salesUserId: lead.ownerUserId,
        triggerType: "followup_due",
        draftMessage: draft,
        aiModel: geminiModel(),
        pushedAt: push.ok ? new Date() : null,
      },
    });
    if (push.ok) {
      // Re-schedule so tomorrow's run doesn't repeat this lead (until WF4 exists).
      const next = new Date(); next.setDate(next.getDate() + 3);
      await prisma.lead.update({ where: { leadId: lead.leadId }, data: { nextActionAt: next } });
      nudged++;
    } else {
      skipped.push(`${idNum}:push_${push.status}`);
    }
  }

  return { ok: true, due: leads.length, nudged, skipped };
}
