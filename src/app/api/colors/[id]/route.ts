import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm, managerAllowedBrandIds } from "@/lib/authz";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

// Rows mirrored from SPS (dms_model_id / dms_color_id set) are owned there:
// renaming or deleting one here would be silently undone by the next 02:00
// catalogue sync, so refuse it and say where to edit instead
// (user req 2026-09-10, src/lib/jobs/dmsCatalogSync.ts).
const SPS_OWNED = "รุ่น/สีนี้ซิงก์มาจาก SPS — แก้ไขที่ SPS แล้วระบบจะดึงมาให้เอง";


// Toggle a color on/off (no hard delete — leads may reference the name).
// Manager settings split (user req 2026-07-12): scoped to the color's
// model's brand.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requirePerm("settings-models", "edit");
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const colorId = Number(id);
  if (!Number.isInteger(colorId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  if (rq.role === "manager") {
    const color = await prisma.vehicleColor.findUnique({ where: { colorId }, include: { model: { select: { brandId: true } } } });
    if (!color) return NextResponse.json({ error: "ไม่พบสี" }, { status: 404 });
    const allowed = await managerAllowedBrandIds(rq.funUserId!);
    if (!allowed.includes(color.model.brandId)) return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขสีของยี่ห้อนี้" }, { status: 403 });
  }

  const owned = await prisma.vehicleColor.findUnique({ where: { colorId }, select: { dmsColorId: true } });
  if (!owned) return NextResponse.json({ error: "ไม่พบสี" }, { status: 404 });
  if (owned.dmsColorId !== null) return NextResponse.json({ error: SPS_OWNED }, { status: 409 });

  const b = (await request.json().catch(() => ({}))) as { isActive?: boolean };
  if (typeof b.isActive !== "boolean") return NextResponse.json({ error: "missing isActive" }, { status: 400 });
  try {
    await prisma.vehicleColor.update({ where: { colorId }, data: { isActive: b.isActive ? 1 : 0 } });
    audit({ action: "settings.update", entityType: "color", entityId: colorId, after: { isActive: b.isActive } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบสี" }, { status: 404 });
  }
}
