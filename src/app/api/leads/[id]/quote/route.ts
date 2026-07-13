import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { getFeatureFlags } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Quotations for a lead (user req 2026-07-11). Same ownership rule as the
 * chat thread: sales only on their own leads, manager+ on any.
 *
 * POST body: {
 *   modelId?, variant?, color?, listPrice, colorPriceAdjust?, discount?,
 *   depositAmount?, paymentType? ('cash'|'finance'), validUntil? (ISO date),
 *   items?: [{ optionType, itemName, itemValue?, isFree }]
 * }
 * Totals are computed server-side — the client preview is display-only, the
 * stored number never trusts it.
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

  const quotes = await prisma.quotation.findMany({
    where: { leadId },
    orderBy: { quoteId: "desc" },
    include: { items: true },
  });
  return NextResponse.json(quotes.map((q) => ({
    quoteId: Number(q.quoteId),
    quoteNo: q.quoteNo,
    variant: q.variant,
    color: q.color,
    totalPrice: q.totalPrice ? Number(q.totalPrice) : null,
    status: q.status,
    sentAt: q.sentAt,
    createdAt: q.createdAt,
    itemCount: q.items.length,
  })));
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const flags = await getFeatureFlags();
  if (!flags.quotationEnabled) {
    return NextResponse.json({ error: "ฟีเจอร์ใบเสนอราคาถูกปิดอยู่ — เปิดได้ที่ตั้งค่า > ตั้งค่าใบเสนอราคา" }, { status: 403 });
  }

  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (rq.role === "sales" && lead.ownerUserId !== rq.funUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const listPrice = num(b.listPrice);
  if (listPrice === null || listPrice <= 0) {
    return NextResponse.json({ error: "กรุณากรอกราคารถ" }, { status: 400 });
  }
  const colorPriceAdjust = num(b.colorPriceAdjust) ?? 0;
  const discount = num(b.discount) ?? 0;
  const depositAmount = num(b.depositAmount) ?? 0;
  const registrationFee = num(b.registrationFee) ?? 0;
  const compulsoryInsurance = num(b.compulsoryInsurance) ?? 0;
  const firstInstallment = num(b.firstInstallment) ?? 0;
  const paymentType = b.paymentType === "cash" || b.paymentType === "finance" ? b.paymentType : null;
  const validUntil = typeof b.validUntil === "string" && b.validUntil ? new Date(b.validUntil) : null;

  const rawItems = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]) : [];
  const items = rawItems
    .filter((it) => typeof it.itemName === "string" && (it.itemName as string).trim())
    .map((it) => ({
      optionType: typeof it.optionType === "string" && it.optionType ? (it.optionType as string).slice(0, 30) : "other",
      itemName: (it.itemName as string).trim().slice(0, 150),
      itemValue: num(it.itemValue),
      isFree: it.isFree === true ? 1 : 0,
    }));

  // ซื้อ items add to the total; ของแถม items are listed at value 0 cost.
  const paidItemsTotal = items.reduce((s, it) => s + (it.isFree ? 0 : it.itemValue ?? 0), 0);
  const totalPrice = listPrice + colorPriceAdjust - discount + paidItemsTotal + registrationFee + compulsoryInsurance + firstInstallment;

  const quote = await prisma.quotation.create({
    data: {
      leadId,
      modelId: num(b.modelId) ? Math.trunc(num(b.modelId)!) : null,
      variant: typeof b.variant === "string" ? b.variant.trim().slice(0, 100) || null : null,
      color: typeof b.color === "string" ? b.color.trim().slice(0, 50) || null : null,
      listPrice, discount, colorPriceAdjust, depositAmount,
      accessoriesValue: paidItemsTotal,
      registrationFee, compulsoryInsurance, firstInstallment,
      totalPrice,
      paymentType,
      validUntil: validUntil && !isNaN(validUntil.getTime()) ? validUntil : null,
      status: "draft",
      shareToken: crypto.randomBytes(16).toString("hex"),
      createdBy: rq.funUserId,
      items: { create: items },
    },
  });

  // Human-readable running number, derived from the row id so it can't
  // collide under concurrent creates.
  const now = new Date();
  const quoteNo = `QT${String(now.getFullYear() + 543).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(quote.quoteId).padStart(4, "0")}`;
  await prisma.quotation.update({ where: { quoteId: quote.quoteId }, data: { quoteNo } });

  await prisma.activity.create({
    data: {
      leadId, activityType: "quote_sent", direction: "internal",
      summary: `สร้างใบเสนอราคา ${quoteNo}`,
      detail: `${quote.variant ?? ""} ${quote.color ?? ""} · ยอดสุทธิ ${totalPrice.toLocaleString()} บาท`.trim(),
      createdBy: rq.funUserId,
    },
  }).catch(() => {});

  return NextResponse.json({ ok: true, quoteId: Number(quote.quoteId), quoteNo }, { status: 201 });
}
