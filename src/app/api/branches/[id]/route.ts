import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const branchId = Number(id);
  if (!Number.isInteger(branchId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.branchName === "string" && b.branchName.trim()) data.branchName = b.branchName.trim();
  if (typeof b.branchCode === "string") data.branchCode = b.branchCode.trim().toUpperCase() || null;
  if (typeof b.brandId === "number" || b.brandId === null) data.brandId = b.brandId;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  if (typeof b.companyNameFull === "string") data.companyNameFull = b.companyNameFull.trim() || null;
  if (typeof b.companyAddress === "string") data.companyAddress = b.companyAddress.trim() || null;
  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.branch.update({ where: { branchId }, data });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String(e).includes("P2002") ? "รหัสสาขานี้ถูกใช้แล้ว" : "ไม่พบสาขา";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}

// Delete policy: a showroom can be deleted while nothing references it; once
// in use (leads, users, channel routing, duty roster) delete is blocked —
// deactivate instead so history stays intact.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const branchId = Number(id);
  if (!Number.isInteger(branchId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const branch = await prisma.branch.findUnique({ where: { branchId } });
  if (!branch) return NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 });

  const [leads, homeUsers, links, rosters, channels] = await Promise.all([
    prisma.lead.count({ where: { branchId } }),
    prisma.funUser.count({ where: { branchId } }),
    prisma.userBranch.count({ where: { branchId } }),
    prisma.dutyRoster.count({ where: { branchId } }),
    branch.branchCode ? prisma.channelConfig.count({ where: { branchCode: branch.branchCode } }) : Promise.resolve(0),
  ]);
  const blockers: string[] = [];
  if (leads) blockers.push(`Lead ${leads} ราย`);
  if (homeUsers) blockers.push(`ผู้ใช้สังกัด ${homeUsers} คน`);
  if (links) blockers.push(`สิทธิ์เข้าสาขา ${links} รายการ`);
  if (rosters) blockers.push(`ตารางเวร ${rosters} รายการ`);
  if (channels) blockers.push(`routing FB→LINE ${channels} รายการ`);
  if (blockers.length) {
    return NextResponse.json({ error: `ลบไม่ได้ — มีการใช้งานอยู่: ${blockers.join(", ")} (ปิดใช้งานแทนได้)` }, { status: 409 });
  }
  await prisma.branch.delete({ where: { branchId } });
  return NextResponse.json({ ok: true });
}
