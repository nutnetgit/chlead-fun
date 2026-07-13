import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const VALID_ROLES = new Set(["sales", "manager", "gm", "admin"]);

// User directory with branch access. ?all=1 includes deactivated users
// (settings page); default = active only (pickers).
export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get("all") === "1";
  const users = await prisma.funUser.findMany({
    where: all ? {} : { isActive: 1 },
    include: { branchLinks: true },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
  return NextResponse.json(users.map((u) => ({
    userId: u.userId, displayName: u.displayName, nickname: u.nickname, phone: u.phone,
    role: u.role, branchId: u.branchId, teamId: u.teamId, lineUserid: u.lineUserid,
    isActive: !!u.isActive,
    approved: !!u.approvedAt,
    pictureUrl: u.pictureUrl,
    branchIds: u.branchLinks.map((b) => b.branchId),
    username: u.username,
    hasPassword: !!u.passwordHash,
    // Raw per-user menu overrides (null = role defaults) — the settings
    // editor needs the overrides themselves, not just the effective list.
    menuAccess: parseMenuAccess(u.menuAccess),
  })));
}

function parseMenuAccess(raw: string | null): Record<string, boolean> | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as Record<string, boolean>; } catch { return null; }
}

// Create user. Body: { displayName, nickname?, role, branchId? (home),
// lineUserid?, branchIds?: number[] (allowed branches) }
export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.displayName || typeof b.displayName !== "string") {
    return NextResponse.json({ error: "missing displayName" }, { status: 400 });
  }
  const role = String(b.role ?? "sales");
  if (!VALID_ROLES.has(role)) return NextResponse.json({ error: "invalid role" }, { status: 400 });

  const user = await prisma.funUser.create({
    data: {
      displayName: b.displayName.trim(),
      nickname: typeof b.nickname === "string" ? b.nickname.trim() || null : null,
      phone: typeof b.phone === "string" ? b.phone.trim() || null : null,
      role: role as never,
      branchId: typeof b.branchId === "number" ? b.branchId : null,
      lineUserid: typeof b.lineUserid === "string" ? b.lineUserid.trim() || null : null,
    },
  });
  const branchIds = Array.isArray(b.branchIds) ? b.branchIds.filter((x) => Number.isInteger(x)) : [];
  if (branchIds.length) {
    await prisma.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId: user.userId, branchId: branchId as number })) });
  }
  return NextResponse.json({ ok: true, userId: user.userId }, { status: 201 });
}
