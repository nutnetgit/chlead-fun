import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { genTempPassword } from "@/lib/password";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";
import { audit, diffFields } from "@/lib/audit";
import { isMenuKey, permsToRows, resolvePerms, PERM_FLAGS, type PermMap, type PermFlags } from "@/lib/menuAccess";

type Ctx = { params: Promise<{ id: string }> };
const VALID_ROLES = new Set(["sales", "manager", "gm", "admin"]);

// Body.perms → validated PermMap (unknown keys/flags dropped). Returns
// undefined when the field wasn't sent, null for "reset to role defaults".
function parsePerms(raw: unknown): PermMap | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: PermMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMenuKey(k) || !v || typeof v !== "object") continue;
    const flags = v as Record<string, unknown>;
    out[k] = Object.fromEntries(PERM_FLAGS.map((f) => [f, flags[f] === true])) as PermFlags;
  }
  return out;
}

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
      audit({ action: "user.update", entityType: "user", entityId: userId, before: { teamId: target.teamId }, after: { teamId: b.teamId } });
    }
    return NextResponse.json({ ok: true });
  }

  const current = await prisma.funUser.findUnique({ where: { userId }, include: { menuRows: true } });
  if (!current) return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof b.displayName === "string" && b.displayName.trim()) data.displayName = b.displayName.trim();
  if (typeof b.nickname === "string") data.nickname = b.nickname.trim() || null;
  if (typeof b.phone === "string") data.phone = b.phone.trim() || null;
  if (typeof b.role === "string" && VALID_ROLES.has(b.role)) data.role = b.role;
  if (typeof b.branchId === "number" || b.branchId === null) data.branchId = b.branchId;
  if (typeof b.teamId === "number" || b.teamId === null) data.teamId = b.teamId;
  if (typeof b.lineUserid === "string") data.lineUserid = b.lineUserid.trim() || null;
  if (typeof b.username === "string") data.username = b.username.trim() || null;
  if (Number.isInteger(b.dmsUserId) || b.dmsUserId === null) data.dmsUserId = b.dmsUserId;
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  // Approval (LINE-registration flow): admin flips this once role/branches are set.
  if (b.approve === true) data.approvedAt = new Date();

  // Per-user permissions (user req 2026-09-09, sql/032): full PermMap →
  // replace rows; null → delete rows (back to role defaults).
  const perms = parsePerms(b.perms);
  if (perms !== undefined) {
    // Lockout guard: an admin editing THEIR OWN account can't drop the
    // settings menu — nobody should be able to strand themselves out of the
    // page that undoes the change.
    if (userId === rq.funUserId && perms !== null && !perms.settings) {
      return NextResponse.json({ error: "ปิดเมนูตั้งค่าของบัญชีตัวเองไม่ได้ — กันล็อกตัวเองออกจากระบบตั้งค่า" }, { status: 400 });
    }
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
      data.branchIds = branchIds;
    }
    if (perms !== undefined) {
      const rows = perms ? permsToRows(perms) : [];
      await prisma.$transaction([
        prisma.userMenu.deleteMany({ where: { userId } }),
        ...(rows.length ? [prisma.userMenu.createMany({ data: rows.map((r) => ({ userId, ...r, updatedBy: rq.funUserId, updatedAt: new Date() })) })] : []),
        // Any pre-032 JSON overrides are superseded the moment rows are managed here.
        prisma.funUser.update({ where: { userId }, data: { menuAccess: null } }),
      ]);
      audit({
        action: "user.perm_change", entityType: "user", entityId: userId,
        before: current.menuRows.length ? resolvePerms(current.role, current.menuRows) : { roleDefault: current.role },
        after: perms ?? { roleDefault: (data.role as string) ?? current.role },
      });
    }
    if (Object.keys(data).length) {
      const { before, after } = diffFields(current as unknown as Record<string, unknown>, data);
      audit({ action: b.resetPassword === true ? "user.password_reset" : (b.approve === true ? "user.approve" : "user.update"), entityType: "user", entityId: userId, before, after });
    }
    return NextResponse.json({ ok: true, tempPassword });
  } catch (e) {
    const s = String(e);
    const msg = s.includes("uk_user_username") ? "ชื่อผู้ใช้นี้ถูกใช้แล้ว"
      : s.includes("uk_user_dms") ? "รหัสผู้ใช้ SPS นี้ถูกผูกกับบัญชีอื่นแล้ว"
      : "ไม่พบผู้ใช้";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
