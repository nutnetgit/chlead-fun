import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";

export async function GET() {
  const rows = await prisma.channelConfig.findMany({ orderBy: [{ brand: "asc" }, { branchCode: "asc" }] });
  return NextResponse.json(rows);
}

// Gated by the settings-channels menu flags (user req 2026-09-09) — a
// non-admin can now be granted this page's write access per user instead of
// the old hard admin/gm role check.
export async function POST(request: NextRequest) {
  const rq = await requirePerm("settings-channels", "add");
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
        active: b.active === 0 ? 0 : 1,
      },
    });
    audit({ action: "settings.update", entityType: "channel", entityId: row.configId, after: { fbPageId: row.fbPageId, fbPageName: row.fbPageName, brand: row.brand, branchCode: row.branchCode, active: row.active }, detail: "create" });
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    // P2002 = fb_page_id already mapped — surface a friendly message.
    const msg = String(e).includes("P2002") ? "FB Page นี้ถูกผูกไว้แล้ว" : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
