import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

// Vehicle model master. ?brandId= narrows to a brand (lead form), ?all=1
// includes inactive (settings page).
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const brandId = p.get("brandId");
  const all = p.get("all") === "1";
  const models = await prisma.vehicleModel.findMany({
    where: { ...(brandId ? { brandId: Number(brandId) } : {}), ...(all ? {} : { isActive: 1 }) },
    include: { colors: { where: all ? {} : { isActive: 1 }, orderBy: { colorId: "asc" } } },
    orderBy: [{ brandId: "asc" }, { modelName: "asc" }],
  });
  return NextResponse.json(models.map((m) => ({
    modelId: m.modelId, brandId: m.brandId, modelName: m.modelName,
    modelCode: m.modelCode, isActive: !!m.isActive,
    colors: m.colors.map((c) => ({ colorId: c.colorId, colorName: c.colorName, isActive: !!c.isActive })),
  })));
}

// Create model. Body: { brandId, modelName, modelCode? }. Manager settings
// split (user req 2026-07-12): a manager can only add models under a brand
// they actually have branch access to — checked server-side, not just hidden
// in the UI, since /settings/models is now reachable by role=manager.
export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.brandId !== "number" || !b.modelName || typeof b.modelName !== "string") {
    return NextResponse.json({ error: "missing brandId/modelName" }, { status: 400 });
  }
  if (rq.role === "manager") {
    const allowed = await managerAllowedBrandIds(rq.funUserId!);
    if (!allowed.includes(b.brandId)) return NextResponse.json({ error: "ไม่มีสิทธิ์เพิ่มรุ่นรถของยี่ห้อนี้" }, { status: 403 });
  }
  const row = await prisma.vehicleModel.create({
    data: {
      brandId: b.brandId,
      modelName: b.modelName.trim(),
      modelCode: typeof b.modelCode === "string" ? b.modelCode.trim() || null : null,
    },
  });
  return NextResponse.json({ ok: true, modelId: row.modelId }, { status: 201 });
}
