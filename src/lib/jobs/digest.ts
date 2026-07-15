import { prisma } from "@/lib/prisma";
import { callGeminiJson, parseModelJson, geminiReady, geminiModel } from "@/lib/gemini";
import { linePush } from "@/lib/flex";
import { isAutomationJobActive } from "@/lib/settings";
import { getLineCredsForBrand } from "@/lib/lineConfig";

/**
 * Morning manager digest by น้องไอรา (Aira) — the org's named AI assistant
 * (user decision 2026-07-08: user-facing AI speaks as "น้องไอรา").
 * In-app cron or manual POST /api/jobs/digest. Gathers the team's live state,
 * asks Gemini to write a short, friendly-but-sharp Thai briefing, pushes it as
 * a LINE DM to every manager/gm with a linked LINE. Safe no-op parts: no
 * managers with LINE yet → text is still returned for verification.
 */
export async function runDigestJob() {
  const gate = await isAutomationJobActive("digest");
  if (!gate.active) return { ok: true, skipped: true, reason: gate.reason };

  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const DAY = 864e5;

  const [active, dueToday, overdueHot, openEscalates, poolWaiting, conflicts, apptToday, newYesterday] = await Promise.all([
    prisma.lead.count({ where: { status: "active" } }),
    prisma.lead.count({ where: { status: "active", nextActionAt: { gte: startToday, lte: endToday } } }),
    prisma.lead.findMany({
      where: { status: "active", temperature: "hot", nextActionAt: { lt: startToday } },
      include: { person: true, brand: true }, take: 5,
    }),
    prisma.slaEvent.count({ where: { resolvedAt: null, eventType: { in: ["idle_escalate", "first_response_breach"] } } }),
    prisma.leadPool.count({ where: { claimedAt: null } }),
    prisma.lead.count({ where: { status: "active", temperatureConflict: 1 } }),
    prisma.appointment.count({ where: { scheduledAt: { gte: startToday, lte: endToday }, status: { in: ["scheduled", "confirmed"] } } }),
    prisma.lead.count({ where: { createdAt: { gte: new Date(startToday.getTime() - DAY), lt: startToday } } }),
  ]);

  const facts = {
    วันนี้: now.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" }),
    Lead_active: active,
    ต้องตามวันนี้: dueToday,
    นัดหมายวันนี้: apptToday,
    "Lead ใหม่เมื่อวาน": newYesterday,
    hot_ค้างเกินกำหนด: overdueHot.map((l) => `${l.person.nickname || l.person.firstName} (${l.brand.brandName})`),
    SLA_รอผู้จัดการตัดสินใจ: openEscalates,
    รอแจกใน_pool: poolWaiting,
    AI_ขัดแย้งรอรีวิว: conflicts,
  };

  let text: string;
  if (geminiReady()) {
    try {
      const prompt =
        "คุณคือ 'น้องไอรา' ผู้ช่วย AI ของทีมขาย Ch.Erawan Group นิสัยสดใส สุภาพ แต่ตรงประเด็น " +
        "เขียนสรุปเช้าสั้นๆ ให้ผู้จัดการฝ่ายขายอ่านใน LINE (ไม่เกิน 8 บรรทัด) จากข้อมูลจริงด้านล่าง " +
        "เริ่มด้วยทักทายสั้นๆ ปิดท้ายด้วย 'จุดที่ควรจี้วันนี้' 1-2 ข้อที่เจาะจงที่สุด ใช้อีโมจิพอประมาณ " +
        'ตอบเป็น JSON เท่านั้น: {"message":"ข้อความ"}\n\nข้อมูล:\n' + JSON.stringify(facts);
      const parsed = parseModelJson<{ message?: string }>(await callGeminiJson(prompt));
      text = parsed.message || "";
    } catch {
      text = "";
    }
  } else text = "";

  // Deterministic fallback so the digest never silently dies on a Gemini hiccup.
  if (!text) {
    text = `☀️ สรุปเช้าจากน้องไอราค่ะ\nLead active ${active} · ต้องตามวันนี้ ${dueToday} · นัดหมาย ${apptToday}\n` +
      (overdueHot.length ? `🔥 HOT ค้างเกินกำหนด ${overdueHot.length} ราย: ${facts.hot_ค้างเกินกำหนด.join(", ")}\n` : "") +
      (openEscalates ? `🚨 SLA รอผู้จัดการตัดสินใจ ${openEscalates} เรื่อง\n` : "") +
      (poolWaiting ? `📥 pool รอแจก ${poolWaiting} ราย\n` : "") +
      `จุดที่ควรจี้วันนี้: ${overdueHot.length ? "เคลียร์ HOT ที่ค้างก่อนค่ะ" : "ตามนัดวันนี้ให้ครบค่ะ"}`;
  }

  // Push to every manager/gm with a linked LINE — sent from THEIR OWN home
  // branch's brand OA (user req 2026-07-15 — retire the single legacy
  // channel everywhere). A digest is company-wide in content, but there's no
  // single "right" brand to send it from, so each manager's home branch is
  // the least-arbitrary choice; getLineCredsForBrand already falls back to
  // the legacy channel for any brand that hasn't configured its own OA yet,
  // so a manager with no home branch still gets the digest, just via the
  // fallback rather than a specific brand's identity.
  const managers = await prisma.funUser.findMany({
    where: { role: { in: ["manager", "gm"] }, isActive: 1, lineUserid: { not: null } },
  });
  const branches = await prisma.branch.findMany({ select: { branchId: true, brandId: true } });
  const brandIdByBranch = new Map(branches.map((b) => [b.branchId, b.brandId]));
  let pushed = 0;
  for (const mgr of managers) {
    if (!mgr.lineUserid) continue;
    const brandId = mgr.branchId !== null ? brandIdByBranch.get(mgr.branchId) ?? null : null;
    const creds = await getLineCredsForBrand(brandId ?? -1);
    if (!creds.accessToken) continue;
    const r = await linePush(creds.accessToken, mgr.lineUserid, [{ type: "text", text }]);
    if (r.ok) pushed++;
  }

  return { ok: true, pushed, managersWithLine: managers.length, model: geminiReady() ? geminiModel() : null, text };
}
