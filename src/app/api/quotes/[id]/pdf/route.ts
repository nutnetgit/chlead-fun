import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Staff-side PDF view — resolves the quote's share token and hands off to
// the public renderer, so there's exactly one PDF code path to maintain.
export async function GET(_request: NextRequest, { params }: Ctx) {
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

  // Build the absolute URL from the trusted public base, NOT
  // request.nextUrl (bug found 2026-07-14: behind the Cloudflare Tunnel,
  // request.nextUrl's origin resolved to the Docker container's own internal
  // hostname:port — e.g. "https://606a34e47332:3000" — so the "view PDF" tab
  // opened a dead internal address instead of the public site).
  const baseUrl = process.env.APP_PUBLIC_URL ?? "https://fun.ch-erawan.com";
  const url = `${baseUrl}/api/public/quote/${quote.shareToken}/pdf?inline=1`;
  return NextResponse.redirect(url);
}
