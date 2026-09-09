import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requirePerm("settings", "edit");
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const brandId = Number(id);
  if (!Number.isInteger(brandId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as { brandName?: string; dmsBrandId?: number | null };
  const name = b.brandName?.trim();
  // Either field alone is a valid edit: renaming, or just filling in the SPS
  // stock_brand.sto_br_id used by the SSO handoff (sql/035).
  const data: { brandName?: string; dmsBrandId?: number | null } = {};
  if (name) data.brandName = name;
  if (typeof b.dmsBrandId === "number" || b.dmsBrandId === null) data.dmsBrandId = b.dmsBrandId || null;
  if (!Object.keys(data).length) return NextResponse.json({ error: "missing brandName" }, { status: 400 });
  try {
    const before = await prisma.brand.findUnique({ where: { brandId } });
    await prisma.brand.update({ where: { brandId }, data });
    audit({ action: "settings.update", entityType: "brand", entityId: brandId, before: { brandName: before?.brandName, dmsBrandId: before?.dmsBrandId }, after: data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "แก้ไขไม่สำเร็จ (ชื่อซ้ำหรือไม่พบแบรนด์)" }, { status: 409 });
  }
}

// Delete policy (user decision 2026-07-07): deletable ONLY while unused —
// any branch / lead / model referencing the brand blocks the delete with a
// reason, so history is never orphaned.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requirePerm("settings", "del");
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
  const row = await prisma.brand.delete({ where: { brandId } });
  audit({ action: "settings.delete", entityType: "brand", entityId: brandId, before: { brandName: row.brandName } });
  return NextResponse.json({ ok: true });
}
