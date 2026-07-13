import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Team directory (fun_team) with live member counts (FunUser.teamId).
// Team + FunUser.teamId already existed in the schema from the original bulk
// migration but had no UI (user req 2026-07-08).
export async function GET() {
  const [teams, users, branches] = await Promise.all([
    prisma.team.findMany({ orderBy: { teamId: "asc" } }),
    prisma.funUser.findMany({ where: { isActive: 1 }, select: { userId: true, teamId: true } }),
    prisma.branch.findMany({ select: { branchId: true, branchName: true } }),
  ]);
  const memberCounts = new Map<number, number>();
  for (const u of users) if (u.teamId !== null) memberCounts.set(u.teamId, (memberCounts.get(u.teamId) ?? 0) + 1);
  const branchName = new Map(branches.map((b) => [b.branchId, b.branchName]));

  return NextResponse.json(teams.map((t) => ({
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

  const team = await prisma.team.create({
    data: {
      teamName,
      branchId: typeof b.branchId === "number" ? b.branchId : null,
      managerUserId: typeof b.managerUserId === "number" ? b.managerUserId : null,
    },
  });
  return NextResponse.json({ ok: true, teamId: team.teamId }, { status: 201 });
}
