import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Toggle a color on/off (no hard delete — leads may reference the name).
// Manager settings split (user req 2026-07-12): scoped to the color's
// model's brand.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
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

  const b = (await request.json().catch(() => ({}))) as { isActive?: boolean };
  if (typeof b.isActive !== "boolean") return NextResponse.json({ error: "missing isActive" }, { status: 400 });
  try {
    await prisma.vehicleColor.update({ where: { colorId }, data: { isActive: b.isActive ? 1 : 0 } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบสี" }, { status: 404 });
  }
}
