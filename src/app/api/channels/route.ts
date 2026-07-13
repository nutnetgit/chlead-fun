import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET() {
  const rows = await prisma.channelConfig.findMany({ orderBy: [{ brand: "asc" }, { branchCode: "asc" }] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json()) as Record<string, unknown>;
  const required = ["fbPageId", "brand", "branchCode", "lineGroupId"] as const;
  for (const k of required) {
    if (!b[k] || typeof b[k] !== "string") {
      return NextResponse.json({ error: `missing ${k}` }, { status: 400 });
    }
  }
  try {
    const row = await prisma.channelConfig.create({
      data: {
        fbPageId: String(b.fbPageId).trim(),
        fbPageName: b.fbPageName ? String(b.fbPageName).trim() : null,
        brand: String(b.brand).trim().toLowerCase(),
        branchCode: String(b.branchCode).trim(),
        lineGroupId: String(b.lineGroupId).trim(),
        gsheetId: b.gsheetId ? String(b.gsheetId).trim() : null,
        active: b.active === 0 ? 0 : 1,
      },
    });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    // P2002 = fb_page_id already mapped — surface a friendly message.
    const msg = String(e).includes("P2002") ? "FB Page นี้ถูกผูกไว้แล้ว" : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
