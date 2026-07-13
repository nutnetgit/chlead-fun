import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Add a color to a model. Body: { colorName }. Re-adding a deactivated color
// reactivates it (unique key on model+name). Manager settings split (user
// req 2026-07-12): scoped to brands the manager has branch access to.
export async function POST(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const modelId = Number(id);
  if (!Number.isInteger(modelId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  if (rq.role === "manager") {
    const model = await prisma.vehicleModel.findUnique({ where: { modelId }, select: { brandId: true } });
    if (!model) return NextResponse.json({ error: "ไม่พบรุ่น" }, { status: 404 });
    const allowed = await managerAllowedBrandIds(rq.funUserId!);
    if (!allowed.includes(model.brandId)) return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขรุ่นรถของยี่ห้อนี้" }, { status: 403 });
  }

  const b = (await request.json().catch(() => ({}))) as { colorName?: string };
  const colorName = b.colorName?.trim();
  if (!colorName) return NextResponse.json({ error: "missing colorName" }, { status: 400 });

  const existing = await prisma.vehicleColor.findFirst({ where: { modelId, colorName } });
  if (existing) {
    await prisma.vehicleColor.update({ where: { colorId: existing.colorId }, data: { isActive: 1 } });
    return NextResponse.json({ ok: true, colorId: existing.colorId });
  }
  const row = await prisma.vehicleColor.create({ data: { modelId, colorName } });
  return NextResponse.json({ ok: true, colorId: row.colorId }, { status: 201 });
}
