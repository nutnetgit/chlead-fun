import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Next 16: dynamic params arrive as a Promise.
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const configId = Number(id);
  if (!Number.isInteger(configId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json()) as Record<string, unknown>;
  // Whitelist editable fields so a stray key can't break the update (CATS pattern).
  const data: Record<string, unknown> = {};
  if (typeof b.fbPageId === "string") data.fbPageId = b.fbPageId.trim();
  if (typeof b.fbPageName === "string") data.fbPageName = b.fbPageName.trim() || null;
  if (typeof b.brand === "string") data.brand = b.brand.trim().toLowerCase();
  if (typeof b.branchCode === "string") data.branchCode = b.branchCode.trim();
  if (typeof b.lineGroupId === "string") data.lineGroupId = b.lineGroupId.trim();
  if (typeof b.gsheetId === "string") data.gsheetId = b.gsheetId.trim() || null;
  if (b.active === 0 || b.active === 1) data.active = b.active;

  try {
    const row = await prisma.channelConfig.update({ where: { configId }, data });
    return NextResponse.json(row);
  } catch (e) {
    const msg = String(e).includes("P2002") ? "FB Page นี้ถูกผูกไว้แล้ว" : "ไม่พบรายการ";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const configId = Number(id);
  if (!Number.isInteger(configId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    await prisma.channelConfig.delete({ where: { configId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
}
