import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.teamName === "string" && b.teamName.trim()) data.teamName = b.teamName.trim();
  if (typeof b.branchId === "number" || b.branchId === null) data.branchId = b.branchId;
  if (typeof b.managerUserId === "number" || b.managerUserId === null) data.managerUserId = b.managerUserId;
  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.team.update({ where: { teamId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบทีม" }, { status: 404 });
  }
}

// Delete-if-unused: blocked while any active user still belongs to the team
// (same convention as branches/sources — unassign members first).
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const members = await prisma.funUser.count({ where: { teamId } });
  if (members) return NextResponse.json({ error: `ลบไม่ได้ — มีสมาชิกในทีม ${members} คน (ย้ายออกก่อน)` }, { status: 409 });

  await prisma.team.delete({ where: { teamId } });
  return NextResponse.json({ ok: true });
}
