import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { genTempPassword } from "@/lib/password";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";
import { MENU_DEFS } from "@/lib/menuAccess";

type Ctx = { params: Promise<{ id: string }> };
const VALID_ROLES = new Set(["sales", "manager", "gm", "admin"]);
const VALID_MENU_KEYS = new Set(MENU_DEFS.map((m) => m.key as string));

// Update user fields and (when branchIds is sent) replace branch access.
// { resetPassword: true } issues a fresh temp password (admin never sees the
// user's real one after they change it) — returned ONCE in the response so
// the admin can hand it over; the user must change it on first login.
//
// Manager exception (user req 2026-07-14): /settings/teams's member-toggle
// calls this exact route to flip teamId, but the route was admin/gm-only —
// a manager using the very page built for them got a silent 403. Now a
// manager may PUT teamId ONLY, and only on a sales/manager user within one
// of their own branches; every other field still 403s for them.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  if (rq.role === "manager") {
    const fields = Object.keys(b).filter((k) => k !== "teamId");
    if (fields.length) return NextResponse.json({ error: "ผู้จัดการแก้ไขได้เฉพาะทีมที่สังกัด" }, { status: 403 });
    const target = await prisma.funUser.findUnique({ where: { userId }, include: { branchLinks: true } });
    if (!target || (target.role !== "sales" && target.role !== "manager")) {
      return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
    }
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    const targetBranchIds = [...target.branchLinks.map((l) => l.branchId), ...(target.branchId ? [target.branchId] : [])];
    if (!targetBranchIds.some((bid) => allowed.includes(bid))) {
      return NextResponse.json({ error: "ผู้ใช้นี้ไม่ได้อยู่ในสาขาของคุณ" }, { status: 403 });
    }
    if (typeof b.teamId === "number" || b.teamId === null) {
      await prisma.funUser.update({ where: { userId }, data: { teamId: b.teamId } });
    }
    return NextResponse.json({ ok: true });
  }

  const data: Record<string, unknown> = {};
  if (typeof b.displayName === "string" && b.displayName.trim()) data.displayName = b.displayName.trim();
  if (typeof b.nickname === "string") data.nickname = b.nickname.trim() || null;
  if (typeof b.phone === "string") data.phone = b.phone.trim() || null;
  if (typeof b.role === "string" && VALID_ROLES.has(b.role)) data.role = b.role;
  if (typeof b.branchId === "number" || b.branchId === null) data.branchId = b.branchId;
  if (typeof b.teamId === "number" || b.teamId === null) data.teamId = b.teamId;
  if (typeof b.lineUserid === "string") data.lineUserid = b.lineUserid.trim() || null;
  if (typeof b.username === "string") data.username = b.username.trim() || null;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  // Approval (LINE-registration flow): admin flips this once role/branches are set.
  if (b.approve === true) data.approvedAt = new Date();

  // Per-user menu access (user req 2026-07-12): object of {menuKey: bool}
  // overrides, or null to reset to role defaults. Unknown keys dropped.
  if (b.menuAccess === null) data.menuAccess = null;
  else if (typeof b.menuAccess === "object" && b.menuAccess && !Array.isArray(b.menuAccess)) {
    const clean = Object.fromEntries(
      Object.entries(b.menuAccess as Record<string, unknown>)
        .filter(([k, v]) => VALID_MENU_KEYS.has(k) && typeof v === "boolean"),
    );
    // Lockout guard: an admin editing THEIR OWN account can't switch off
    // the settings menu — nobody should be able to strand themselves out
    // of the page that undoes the change.
    if (userId === rq.funUserId && clean.settings === false) {
      return NextResponse.json({ error: "ปิดเมนูตั้งค่าของบัญชีตัวเองไม่ได้ — กันล็อกตัวเองออกจากระบบตั้งค่า" }, { status: 400 });
    }
    data.menuAccess = JSON.stringify(clean);
  }

  let tempPassword: string | undefined;
  if (b.resetPassword === true) {
    tempPassword = genTempPassword();
    data.passwordHash = await bcrypt.hash(tempPassword, 10);
    data.mustChangePassword = 1;
    data.failedLoginCount = 0;
    data.lockedUntil = null;
  }

  try {
    if (Object.keys(data).length) await prisma.funUser.update({ where: { userId }, data });
    if (Array.isArray(b.branchIds)) {
      const branchIds = b.branchIds.filter((x) => Number.isInteger(x)) as number[];
      await prisma.$transaction([
        prisma.userBranch.deleteMany({ where: { userId } }),
        ...(branchIds.length ? [prisma.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId, branchId })) })] : []),
      ]);
    }
    return NextResponse.json({ ok: true, tempPassword });
  } catch (e) {
    const msg = String(e).includes("uk_user_username") ? "ชื่อผู้ใช้นี้ถูกใช้แล้ว" : "ไม่พบผู้ใช้";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
