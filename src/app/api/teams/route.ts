import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

// Team directory (fun_team) with live member counts (FunUser.teamId).
// Team + FunUser.teamId already existed in the schema from the original bulk
// migration but had no UI (user req 2026-07-08).
//
// Branch/brand scoping (user req 2026-07-14 permission audit): GET had no
// role check at all before this, and no branch scoping for manager either —
// a manager saw and could edit every team across every brand. Read stays
// global for admin/gm; manager sees only teams in their own branches (a
// team with no branchId is unassigned/ambiguous, shown to admin/gm only).
export async function GET() {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  let branchScope: number[] | null = null;
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (allowed.length) branchScope = allowed;
  }

  const [teams, users, branches] = await Promise.all([
    prisma.team.findMany({ orderBy: { teamId: "asc" } }),
    prisma.funUser.findMany({ where: { isActive: 1 }, select: { userId: true, teamId: true } }),
    prisma.branch.findMany({ select: { branchId: true, branchName: true } }),
  ]);
  const memberCounts = new Map<number, number>();
  for (const u of users) if (u.teamId !== null) memberCounts.set(u.teamId, (memberCounts.get(u.teamId) ?? 0) + 1);
  const branchName = new Map(branches.map((b) => [b.branchId, b.branchName]));

  const visible = branchScope
    ? teams.filter((t) => t.branchId !== null && branchScope!.includes(t.branchId))
    : teams;

  return NextResponse.json(visible.map((t) => ({
    teamId: t.teamId, teamName: t.teamName, branchId: t.branchId,
    branchName: t.branchId ? branchName.get(t.branchId) ?? null : null,
    managerUserId: t.managerUserId,
    memberCount: memberCounts.get(t.teamId) ?? 0,
  })));
}

// Create team. Body: { teamName, branchId?, managerUserId? }
export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const teamName = typeof b.teamName === "string" ? b.teamName.trim() : "";
  if (!teamName) return NextResponse.json({ error: "missing teamName" }, { status: 400 });

  const branchId = typeof b.branchId === "number" ? b.branchId : null;
  // A manager must file the team under one of their own branches — no
  // creating a team for a brand they don't manage.
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (branchId === null || !allowed.includes(branchId)) {
      return NextResponse.json({ error: "ผู้จัดการต้องระบุสาขาของตัวเองเป็นเจ้าของทีม" }, { status: 403 });
    }
  }

  const team = await prisma.team.create({
    data: { teamName, branchId, managerUserId: typeof b.managerUserId === "number" ? b.managerUserId : null },
  });
  return NextResponse.json({ ok: true, teamId: team.teamId }, { status: 201 });
}
