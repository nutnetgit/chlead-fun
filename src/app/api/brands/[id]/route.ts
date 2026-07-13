import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as { brandName?: string };
  const name = b.brandName?.trim();
  if (!name) return NextResponse.json({ error: "missing brandName" }, { status: 400 });
  try {
    await prisma.brand.update({ where: { brandId }, data: { brandName: name } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "แก้ไขไม่สำเร็จ (ชื่อซ้ำหรือไม่พบแบรนด์)" }, { status: 409 });
  }
}

// Delete policy (user decision 2026-07-07): deletable ONLY while unused —
// any branch / lead / model referencing the brand blocks the delete with a
// reason, so history is never orphaned.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const [branches, leads, models] = await Promise.all([
    prisma.branch.count({ where: { brandId } }),
    prisma.lead.count({ where: { brandId } }),
    prisma.vehicleModel.count({ where: { brandId } }),
  ]);
  const blockers: string[] = [];
  if (branches) blockers.push(`สาขา ${branches} แห่ง`);
  if (leads) blockers.push(`Lead ${leads} ราย`);
  if (models) blockers.push(`รุ่นรถ ${models} รุ่น`);
  if (blockers.length) {
    return NextResponse.json({ error: `ลบไม่ได้ — มีการใช้งานอยู่: ${blockers.join(", ")}` }, { status: 409 });
  }
  await prisma.brand.delete({ where: { brandId } });
  return NextResponse.json({ ok: true });
}
