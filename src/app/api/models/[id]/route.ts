import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// A manager may only touch a model whose brand they have branch access to
// (user req 2026-07-12) — checked against the row's actual brandId, not
// anything client-supplied.
async function assertManagerCanTouch(role: string | null, funUserId: number | null, modelId: number): Promise<NextResponse | null> {
  if (role !== "manager") return null;
  const model = await prisma.vehicleModel.findUnique({ where: { modelId }, select: { brandId: true } });
  if (!model) return NextResponse.json({ error: "ไม่พบรุ่น" }, { status: 404 });
  const allowed = await managerAllowedBrandIds(funUserId!);
  if (!allowed.includes(model.brandId)) return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขรุ่นรถของยี่ห้อนี้" }, { status: 403 });
  return null;
}

// Update model name/code/active.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const modelId = Number(id);
  if (!Number.isInteger(modelId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const denied = await assertManagerCanTouch(rq.role, rq.funUserId, modelId);
  if (denied) return denied;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.modelName === "string" && b.modelName.trim()) data.modelName = b.modelName.trim();
  if (typeof b.modelCode === "string") data.modelCode = b.modelCode.trim() || null;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  try {
    await prisma.vehicleModel.update({ where: { modelId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรุ่น" }, { status: 404 });
  }
}

// Delete-if-unused (same policy as brand/branch): blocked once any lead
// references the model; deactivate instead.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const modelId = Number(id);
  if (!Number.isInteger(modelId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const denied = await assertManagerCanTouch(rq.role, rq.funUserId, modelId);
  if (denied) return denied;

  const leads = await prisma.lead.count({ where: { interestedModelId: modelId } });
  if (leads) {
    return NextResponse.json({ error: `ลบไม่ได้ — มี Lead อ้างถึงรุ่นนี้ ${leads} ราย (ปิดใช้งานแทนได้)` }, { status: 409 });
  }
  await prisma.$transaction([
    prisma.vehicleColor.deleteMany({ where: { modelId } }),
    prisma.vehicleModel.delete({ where: { modelId } }),
  ]);
  return NextResponse.json({ ok: true });
}
