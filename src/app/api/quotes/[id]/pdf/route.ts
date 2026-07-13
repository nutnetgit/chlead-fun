import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Staff-side PDF view — resolves the quote's share token and hands off to
// the public renderer, so there's exactly one PDF code path to maintain.
export async function GET(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const quoteId = BigInt(id || "0");
  const quote = await prisma.quotation.findUnique({ where: { quoteId } });
  if (!quote?.shareToken) return NextResponse.json({ error: "ไม่พบใบเสนอราคา" }, { status: 404 });

  const lead = await prisma.lead.findUnique({ where: { leadId: quote.leadId } });
  if (rq.role === "sales" && lead?.ownerUserId !== rq.funUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/api/public/quote/${quote.shareToken}/pdf`;
  url.search = "?inline=1";
  return NextResponse.redirect(url);
}
