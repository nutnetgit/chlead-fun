import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { genTempPassword } from "@/lib/password";
import { requireRole } from "@/lib/authz";
import { MENU_DEFS } from "@/lib/menuAccess";

type Ctx = { params: Promise<{ id: string }> };
const VALID_ROLES = new Set(["sales", "manager", "gm", "admin"]);
const VALID_MENU_KEYS = new Set(MENU_DEFS.map((m) => m.key as string));

// Update user fields and (when branchIds is sent) replace branch access.
// { resetPassword: true } issues a fresh temp password (admin never sees the
// user's real one after they change it) — returned ONCE in the response so
// the admin can hand it over; the user must change it on first login.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
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
