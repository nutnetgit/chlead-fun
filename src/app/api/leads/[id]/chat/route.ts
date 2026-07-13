import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { linePush } from "@/lib/flex";
import { requireRole } from "@/lib/authz";
import { getLineCredsForBrand } from "@/lib/lineConfig";
import { getFeatureFlags } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };

/**
 * In-house LINE chat, per-lead thread (user req 2026-07-08). GET lists the
 * conversation; POST sends a staff reply via the existing linePush() helper
 * (already quota-tracked, see src/lib/flex.ts) and logs it. Both are scoped:
 * a `sales` caller may only see/reply to their OWN leads — manager/gm/admin
 * can act on any lead (matches the same ownership rule already enforced for
 * the QR generator's salesperson picker).
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (rq.role === "sales" && lead.ownerUserId !== rq.funUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { leadId }, orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(messages.map((m) => ({
    messageId: Number(m.messageId), direction: m.direction, body: m.body,
    sentByUserId: m.sentByUserId, createdAt: m.createdAt,
  })));
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  // Global kill-switch (user req 2026-07-14, /settings/line-oa) — free-text
  // chat replies burn LINE push quota; quotation sending is a separate flow
  // and stays available even while this is off.
  const flags = await getFeatureFlags();
  if (!flags.chatSendEnabled) {
    return NextResponse.json({ error: "ปิดการส่งแชทชั่วคราว (ประหยัดโควต้า LINE) — ตอบลูกค้าทาง LINE OA Manager แทน" }, { status: 403 });
  }

  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (rq.role === "sales" && lead.ownerUserId !== rq.funUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const b = (await request.json().catch(() => ({}))) as { text?: string };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return NextResponse.json({ error: "กรุณากรอกข้อความ" }, { status: 400 });

  const ident = await prisma.personIdentifier.findFirst({
    where: { personId: lead.personId, idType: "line_userid" },
  });
  if (!ident) return NextResponse.json({ error: "ลูกค้ายังไม่ได้ผูก LINE — ส่งไม่ได้" }, { status: 400 });

  const creds = await getLineCredsForBrand(lead.brandId);
  if (!creds.accessToken) return NextResponse.json({ error: "LINE token not set" }, { status: 503 });

  const push = await linePush(creds.accessToken, ident.idValue, [{ type: "text", text }]);
  if (!push.ok) return NextResponse.json({ error: "ส่งไม่สำเร็จ" }, { status: 502 });

  const message = await prisma.chatMessage.create({
    data: { leadId, direction: "outbound", lineUserId: ident.idValue, sentByUserId: rq.funUserId, body: text },
  });
  return NextResponse.json({ ok: true, messageId: Number(message.messageId) }, { status: 201 });
}
