import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { linePushFlex, buildQuotePdfBubble } from "@/lib/flex";
import { getLineCredsForBrand } from "@/lib/lineConfig";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Push a quotation to the customer over LINE (user req 2026-07-11, switched
 * to a Flex card 2026-07-12). LINE's Messaging API can't attach a PDF file
 * directly, so the card's button links to the public PDF endpoint (share-
 * token URL, no login needed) — served as an attachment so LINE's in-app
 * browser downloads it instead of trying to render it inline (which was the
 * "cannot load" bug). The send is also logged as an outbound ChatMessage so
 * it shows up in the /chat thread like any other staff reply (stored as a
 * text summary — fun_chat_message is text-only, not flex-aware).
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const quoteId = BigInt(id || "0");
  const quote = await prisma.quotation.findUnique({ where: { quoteId } });
  if (!quote) return NextResponse.json({ error: "ไม่พบใบเสนอราคา" }, { status: 404 });

  const lead = await prisma.lead.findUnique({ where: { leadId: quote.leadId }, include: { person: true, branch: true } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (rq.role === "sales" && lead.ownerUserId !== rq.funUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ident = await prisma.personIdentifier.findFirst({
    where: { personId: lead.personId, idType: "line_userid" },
  });
  if (!ident) return NextResponse.json({ error: "ลูกค้ายังไม่ได้ผูก LINE — ส่งไม่ได้" }, { status: 400 });

  const creds = await getLineCredsForBrand(lead.brandId);
  if (!creds.accessToken) return NextResponse.json({ error: "LINE token not set" }, { status: 503 });

  const baseUrl = process.env.APP_PUBLIC_URL ?? "https://fun.ch-erawan.com";
  const pdfUrl = `${baseUrl}/api/public/quote/${quote.shareToken}/pdf`;
  const customerName = lead.person.nickname || lead.person.firstName || "ลูกค้า";
  const quoteNo = quote.quoteNo ?? `#${Number(quote.quoteId)}`;
  const totalPrice = quote.totalPrice ? Number(quote.totalPrice) : null;

  const companyName = lead.branch.companyNameFull || "บริษัทในเครือ ช.เอราวัณ กรุ๊ป";
  const { altText, contents } = buildQuotePdfBubble({
    quoteNo, customerName, companyName, createdAt: quote.createdAt,
    variant: quote.variant, color: quote.color, totalPrice, pdfUrl,
  });
  const push = await linePushFlex(creds.accessToken, ident.idValue, altText, contents);
  if (!push.ok) return NextResponse.json({ error: "ส่งไม่สำเร็จ" }, { status: 502 });

  // Staff-facing link back to this PDF (user-reported 2026-07-13: once sent,
  // there was nowhere in our own UI to reopen it) — relative path so it
  // works regardless of host, opens inline via the ?inline=1 the staff route
  // already appends. /chat linkifies any URL found in a message body.
  const summary =
    `เรียนคุณ ${customerName}\nใบเสนอราคาเลขที่ ${quoteNo}` +
    `${quote.variant ? `\n${quote.variant}${quote.color ? ` สี${quote.color}` : ""}` : ""}` +
    `${totalPrice ? `\nยอดสุทธิ ${totalPrice.toLocaleString()} บาท` : ""}` +
    `\n/api/quotes/${Number(quoteId)}/pdf`;

  await prisma.$transaction([
    prisma.chatMessage.create({
      data: { leadId: lead.leadId, direction: "outbound", lineUserId: ident.idValue, sentByUserId: rq.funUserId, body: summary },
    }),
    prisma.quotation.update({ where: { quoteId }, data: { status: "sent", sentAt: new Date() } }),
  ]);
  return NextResponse.json({ ok: true });
}
