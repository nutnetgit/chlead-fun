import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm, managerAllowedBranchIds } from "@/lib/authz";
import { audit, diffFields } from "@/lib/audit";
import type { PermFlag } from "@/lib/menuAccess";

type Ctx = { params: Promise<{ id: string }> };

// Branch-scoped write access (user req 2026-07-14, mirrors the events audit):
// admin/gm touch any team; a manager only teams owned by one of their own
// branches — a team with no branchId is admin/gm-only. The per-menu flag
// (edit/del) comes from fun_user_menu (user req 2026-09-09).
async function checkTeamWriteAccess(teamId: number, flag: PermFlag) {
  const rq = await requirePerm("settings-teams", flag);
  if (!rq.ok) return { ok: false as const, response: rq.response };
  const team = await prisma.team.findUnique({ where: { teamId } });
  if (!team) return { ok: false as const, response: NextResponse.json({ error: "ไม่พบทีม" }, { status: 404 }) };
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (team.branchId === null || !allowed.includes(team.branchId)) {
      return { ok: false as const, response: NextResponse.json({ error: "ทีมนี้ไม่ได้อยู่ในสาขาของคุณ" }, { status: 403 }) };
    }
  }
  return { ok: true as const, role: rq.role, funUserId: rq.funUserId, team };
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const access = await checkTeamWriteAccess(teamId, "edit");
  if (!access.ok) return access.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.teamName === "string" && b.teamName.trim()) data.teamName = b.teamName.trim();
  if (typeof b.managerUserId === "number" || b.managerUserId === null) data.managerUserId = b.managerUserId;
  // Reassigning the owning branch: admin/gm freely; a manager only between
  // their own branches (mirrors /api/events/[id]'s same rule).
  if (typeof b.branchId === "number" || b.branchId === null) {
    if (access.role === "manager") {
      const allowed = await managerAllowedBranchIds(access.funUserId!);
      if (b.branchId === null || !allowed.includes(b.branchId as number)) {
        return NextResponse.json({ error: "ย้ายทีมไปสาขาที่ไม่ใช่ของคุณไม่ได้" }, { status: 403 });
      }
    }
    data.branchId = b.branchId;
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.team.update({ where: { teamId }, data });
    audit({ action: "settings.update", entityType: "team", entityId: teamId, branchId: access.team.branchId, ...diffFields(access.team as unknown as Record<string, unknown>, data) });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบทีม" }, { status: 404 });
  }
}

// Delete-if-unused: blocked while any active user still belongs to the team
// (same convention as branches/sources — unassign members first).
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const teamId = Number(id);
  if (!Number.isInteger(teamId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const access = await checkTeamWriteAccess(teamId, "del");
  if (!access.ok) return access.response;

  const members = await prisma.funUser.count({ where: { teamId } });
  if (members) return NextResponse.json({ error: `ลบไม่ได้ — มีสมาชิกในทีม ${members} คน (ย้ายออกก่อน)` }, { status: 409 });

  await prisma.team.delete({ where: { teamId } });
  audit({ action: "settings.delete", entityType: "team", entityId: teamId, branchId: access.team.branchId, before: { teamName: access.team.teamName } });
  return NextResponse.json({ ok: true });
}
