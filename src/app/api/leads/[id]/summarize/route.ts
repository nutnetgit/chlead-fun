import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { callGeminiJson, parseModelJson, geminiReady } from "@/lib/gemini";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * "สรุปโดยน้องไอรา" — reads the whole timeline + lead fields and returns a
 * 3-line Thai brief: where the customer stands, what's blocking, what to do
 * next. Ephemeral (NOT stored as an activity — that would reset the SLA idle
 * clock). No phone/citizen data goes to the AI (PDPA).
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({
    where: { leadId },
    include: {
      person: true, brand: true, channel: true,
      activities: { orderBy: { createdAt: "asc" }, take: 40 },
      history: { orderBy: { historyId: "asc" } },
      nudges: { orderBy: { nudgeId: "desc" }, take: 3 },
    },
  });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!geminiReady()) return NextResponse.json({ error: "AI ยังไม่พร้อม (ไม่มี GEMINI_API_KEY)" }, { status: 503 });

  const facts = {
    ชื่อเล่นลูกค้า: lead.person.nickname || lead.person.firstName,
    แบรนด์: lead.brand.brandName,
    รุ่นที่สนใจ: lead.interestedVariant,
    สี: lead.interestedColor,
    ช่องทางที่มา: lead.channel.channelName,
    วิธีชำระ: lead.paymentType,
    สถานะปัจจุบัน: lead.stage,
    temperature: lead.temperature,
    ai_score: lead.aiScore,
    เหตุผลคะแนน: lead.aiScoreReason,
    "วันที่ได้ Lead": lead.createdAt?.toISOString().slice(0, 10),
    ติดต่อล่าสุด: lead.lastActivityAt?.toISOString().slice(0, 10),
    นัดถัดไป: lead.nextActionAt?.toISOString().slice(0, 10),
    ประวัติ: lead.activities.map((a) => ({
      วันที่: a.createdAt?.toISOString().slice(0, 10),
      ประเภท: a.activityType, ผล: a.outcome, สรุป: a.summary, รายละเอียด: a.detail?.slice(0, 150),
    })),
    การเปลี่ยนสถานะ: lead.history.map((h) => `${h.fromStage ?? "-"}→${h.toStage}`),
  };

  try {
    const prompt =
      "คุณคือ 'น้องไอรา' ผู้ช่วย AI ทีมขาย สรุปลูกค้ารายนี้ให้เซลส์/ผู้จัดการอ่านเข้าใจใน 10 วินาที " +
      "เป็นภาษาไทย 3 บรรทัดพอดี: (1) ตอนนี้ลูกค้าอยู่ตรงไหนของการซื้อ (2) ติดอะไรอยู่ (3) ควรทำอะไรต่อที่เจาะจงที่สุด " +
      'ห้ามใส่เบอร์โทร ตอบเป็น JSON เท่านั้น: {"line1":"...","line2":"...","line3":"..."}\n\nข้อมูล:\n' +
      JSON.stringify(facts);
    const parsed = parseModelJson<{ line1?: string; line2?: string; line3?: string }>(await callGeminiJson(prompt));
    if (!parsed.line1) throw new Error("empty");
    return NextResponse.json({ ok: true, lines: [parsed.line1, parsed.line2 ?? "", parsed.line3 ?? ""].filter(Boolean) });
  } catch (e) {
    return NextResponse.json({ error: `ไอราสรุปไม่สำเร็จ: ${String(e).slice(0, 120)}` }, { status: 502 });
  }
}
