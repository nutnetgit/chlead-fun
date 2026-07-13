import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildQuotePdf } from "@/lib/quotePdf";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

// Customer-facing quotation PDF (user req 2026-07-11) — opened from the link
// pushed over LINE, so it must work without a login. Access control is the
// share token itself: 32 hex chars of crypto randomness per quote, not
// enumerable, and only ever handed to the customer the quote belongs to.
export async function GET(request: NextRequest, { params }: Ctx) {
  const { token } = await params;
  if (!token || token.length < 16) return NextResponse.json({ error: "not found" }, { status: 404 });

  const quote = await prisma.quotation.findUnique({
    where: { shareToken: token },
    include: { items: true },
  });
  if (!quote) return NextResponse.json({ error: "not found" }, { status: 404 });

  const lead = await prisma.lead.findUnique({
    where: { leadId: quote.leadId },
    include: { person: true, brand: true, branch: true },
  });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [owner, phone, model] = await Promise.all([
    lead.ownerUserId ? prisma.funUser.findUnique({ where: { userId: lead.ownerUserId } }) : Promise.resolve(null),
    prisma.personIdentifier.findFirst({ where: { personId: lead.personId, idType: { in: ["phone", "phone2"] } } }),
    quote.modelId ? prisma.vehicleModel.findUnique({ where: { modelId: quote.modelId } }) : Promise.resolve(null),
  ]);

  const pdf = await buildQuotePdf({
    quoteNo: quote.quoteNo ?? `#${Number(quote.quoteId)}`,
    createdAt: quote.createdAt,
    validUntil: quote.validUntil,
    companyName: lead.branch.companyNameFull || "บริษัทในเครือ ช.เอราวัณ กรุ๊ป",
    companyAddress: lead.branch.companyAddress,
    brandName: lead.brand.brandName,
    branchName: lead.branch.branchName,
    customerName: [lead.person.prefix, lead.person.firstName, lead.person.lastName].filter(Boolean).join(" ")
      || lead.person.nickname || "ลูกค้า",
    customerPhone: phone?.idValue ?? null,
    variant: quote.variant,
    color: quote.color,
    modelCode: model?.modelCode ?? null,
    listPrice: Number(quote.listPrice ?? 0),
    colorPriceAdjust: Number(quote.colorPriceAdjust ?? 0),
    discount: Number(quote.discount ?? 0),
    depositAmount: Number(quote.depositAmount ?? 0),
    registrationFee: Number(quote.registrationFee ?? 0),
    compulsoryInsurance: Number(quote.compulsoryInsurance ?? 0),
    firstInstallment: Number(quote.firstInstallment ?? 0),
    paymentType: quote.paymentType,
    items: quote.items.map((it) => ({
      itemName: it.itemName,
      optionType: it.optionType,
      itemValue: it.itemValue !== null ? Number(it.itemValue) : null,
      isFree: !!it.isFree,
    })),
    accessoriesValue: Number(quote.accessoriesValue ?? 0),
    totalPrice: Number(quote.totalPrice ?? 0),
    salesName: owner?.displayName || "-",
    salesPhone: owner?.phone ?? null,
  });

  // attachment by default (user-reported 2026-07-12: "cannot load" from the
  // LINE Flex button) — LINE's in-app browser can't reliably render a PDF
  // inline in its webview, but it CAN download one and hand it to the
  // device's own PDF viewer when the response says to download.
  //
  // Staff clicking "view" from /quotes/new on a desktop browser want the
  // opposite — a normal browser tab just silently downloads an "attachment"
  // response instead of showing it (user-reported 2026-07-13: "button
  // doesn't work, can't show PDF in new tab"). The staff-only redirect at
  // /api/quotes/[id]/pdf appends ?inline=1 for exactly this case; the public
  // link pushed to customers over LINE never carries that param, so it keeps
  // getting attachment as before.
  const disposition = request.nextUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="quotation-${quote.quoteNo ?? Number(quote.quoteId)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
