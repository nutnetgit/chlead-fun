import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { isMenuKey, permsToRows, roleDefaultPerms, type PermMap } from "@/lib/menuAccess";

export const runtime = "nodejs";

/**
 * One-time conversion of the pre-032 fun_user.menu_access JSON overrides
 * ({"menuKey": bool}) into fun_user_menu rows (user req 2026-09-09). For each
 * user still carrying JSON: keys true → a row with the role's default flags
 * for that menu (or view-only if the role never had it); keys false → no
 * row; menus the JSON doesn't mention keep the role default. Then NULLs the
 * JSON. Users with NULL JSON are untouched (they stay on role defaults).
 *
 * GET  → count of users still needing migration · POST ?dry=1 → preview ·
 * POST → apply. Admin (settings·edit) only.
 */
function convert(role: string, json: string): PermMap | null {
  let overrides: Record<string, boolean>;
  try { overrides = JSON.parse(json) as Record<string, boolean>; } catch { return null; }
  const defaults = roleDefaultPerms(role);
  const out: PermMap = { ...defaults };
  for (const [k, v] of Object.entries(overrides)) {
    if (!isMenuKey(k) || typeof v !== "boolean") continue;
    if (v) out[k] = defaults[k] ?? { add: false, edit: false, cancel: false, del: false, report: false, viewall: false };
    else delete out[k];
  }
  return out;
}

export async function GET() {
  const rq = await requirePerm("settings");
  if (!rq.ok) return rq.response;
  const pending = await prisma.funUser.count({ where: { menuAccess: { not: null } } });
  return NextResponse.json({ pending });
}

export async function POST(request: NextRequest) {
  const rq = await requirePerm("settings", "edit");
  if (!rq.ok) return rq.response;
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const users = await prisma.funUser.findMany({ where: { menuAccess: { not: null } } });
  const preview: { userId: number; displayName: string; menus: string[] }[] = [];
  let migrated = 0, skipped = 0;
  for (const u of users) {
    const perms = u.menuAccess ? convert(u.role, u.menuAccess) : null;
    if (!perms) { skipped++; continue; }
    preview.push({ userId: u.userId, displayName: u.displayName, menus: Object.keys(perms) });
    if (dry) continue;
    const rows = permsToRows(perms);
    await prisma.$transaction([
      prisma.userMenu.deleteMany({ where: { userId: u.userId } }),
      ...(rows.length ? [prisma.userMenu.createMany({ data: rows.map((r) => ({ userId: u.userId, ...r, updatedBy: rq.funUserId, updatedAt: new Date() })) })] : []),
      prisma.funUser.update({ where: { userId: u.userId }, data: { menuAccess: null } }),
    ]);
    migrated++;
    audit({ action: "user.perm_change", entityType: "user", entityId: u.userId, detail: "migrate menu_access → rows", after: perms });
  }
  return NextResponse.json({ ok: true, dry, migrated, skipped, preview });
}
