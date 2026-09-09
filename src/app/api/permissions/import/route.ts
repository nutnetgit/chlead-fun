import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { checkApiToken } from "@/lib/sso";
import { MENU_DEFS, isMenuKey, type MenuKey, type PermFlags } from "@/lib/menuAccess";

export const runtime = "nodejs";

/**
 * Permission import from the SPS/DMS side (user req 2026-09-09). Accepts the
 * export shape, or raw legacy `user_menu` rows. Users are matched by
 * fun_user_id → dms_user_id → line_userid → username (first hit wins);
 * menus by menu_key, else legacy_code (u_me_menu) via MENU_DEFS.legacyCode.
 * A user's rows are REPLACED (not merged) — send the full set.
 *
 *   { dryRun?: true,
 *     users: [{ fun_user_id?|dms_user_id?|line_userid?|username?,
 *               menus: [{ menu_key?|legacy_code?, add,edit,cancel,del,report,viewall }] }] }
 *   or { rows: [{ u_id, u_me_menu, u_me_add, u_me_edit, u_me_cancel, u_me_del, u_me_report, u_me_viewall }] }
 */
type InMenu = { menu_key?: string; legacy_code?: string; add?: unknown; edit?: unknown; cancel?: unknown; del?: unknown; report?: unknown; viewall?: unknown };
type InUser = { fun_user_id?: unknown; dms_user_id?: unknown; line_userid?: unknown; username?: unknown; menus?: InMenu[] };
type LegacyRow = { u_id?: unknown; u_me_menu?: unknown; u_me_add?: unknown; u_me_edit?: unknown; u_me_cancel?: unknown; u_me_del?: unknown; u_me_report?: unknown; u_me_viewall?: unknown };

const on = (v: unknown) => v === true || v === 1 || v === "1";

export async function POST(request: NextRequest) {
  let viaApi = false;
  if (checkApiToken(request.headers.get("x-api-token"))) viaApi = true;
  else {
    const rq = await requirePerm("settings", "edit");
    if (!rq.ok) return rq.response;
  }
  const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; users?: InUser[]; rows?: LegacyRow[] };
  const dryRun = body.dryRun === true;

  // Legacy rows → per-user groups keyed by dms_user_id.
  let users: InUser[] = Array.isArray(body.users) ? body.users : [];
  if (Array.isArray(body.rows)) {
    const byUid = new Map<number, InUser>();
    for (const r of body.rows) {
      const uid = Number(r.u_id);
      if (!Number.isInteger(uid)) continue;
      const u = byUid.get(uid) ?? { dms_user_id: uid, menus: [] };
      u.menus!.push({ legacy_code: String(r.u_me_menu ?? ""), add: r.u_me_add, edit: r.u_me_edit, cancel: r.u_me_cancel, del: r.u_me_del, report: r.u_me_report, viewall: r.u_me_viewall });
      byUid.set(uid, u);
    }
    users = [...users, ...byUid.values()];
  }
  if (!users.length) return NextResponse.json({ error: "no users/rows" }, { status: 400 });

  const byLegacy = new Map<string, MenuKey>();
  for (const m of MENU_DEFS) if (m.legacyCode && !byLegacy.has(m.legacyCode)) byLegacy.set(m.legacyCode, m.key);

  const all = await prisma.funUser.findMany({ select: { userId: true, dmsUserId: true, lineUserid: true, username: true } });
  const findUser = (u: InUser) =>
    (Number.isInteger(u.fun_user_id) && all.find((x) => x.userId === u.fun_user_id)) ||
    (Number.isInteger(u.dms_user_id) && all.find((x) => x.dmsUserId === u.dms_user_id)) ||
    (typeof u.line_userid === "string" && u.line_userid && all.find((x) => x.lineUserid === u.line_userid)) ||
    (typeof u.username === "string" && u.username && all.find((x) => x.username === u.username)) || null;

  const report: { matched: number; unmatched: unknown[]; rowsWritten: number; unknownMenus: string[] } = { matched: 0, unmatched: [], rowsWritten: 0, unknownMenus: [] };
  const unknownMenus = new Set<string>();
  const writes: { userId: number; rows: ({ menuKey: MenuKey } & Record<`can${"Add" | "Edit" | "Cancel" | "Del" | "Report" | "Viewall"}`, number>)[] }[] = [];

  for (const u of users) {
    const target = findUser(u);
    if (!target) { report.unmatched.push({ fun_user_id: u.fun_user_id, dms_user_id: u.dms_user_id, username: u.username }); continue; }
    const merged = new Map<MenuKey, PermFlags>();
    for (const m of u.menus ?? []) {
      const key: MenuKey | null = m.menu_key && isMenuKey(m.menu_key) ? m.menu_key : (m.legacy_code ? byLegacy.get(m.legacy_code) ?? null : null);
      if (!key) { if (m.menu_key || m.legacy_code) unknownMenus.add(m.menu_key ?? m.legacy_code!); continue; }
      // Several legacy codes may fold into one menu (e.g. sps15 twice) — OR the flags.
      const prev = merged.get(key) ?? { add: false, edit: false, cancel: false, del: false, report: false, viewall: false };
      merged.set(key, { add: prev.add || on(m.add), edit: prev.edit || on(m.edit), cancel: prev.cancel || on(m.cancel), del: prev.del || on(m.del), report: prev.report || on(m.report), viewall: prev.viewall || on(m.viewall) });
    }
    report.matched++;
    writes.push({ userId: target.userId, rows: [...merged].map(([menuKey, p]) => ({ menuKey, canAdd: +p.add, canEdit: +p.edit, canCancel: +p.cancel, canDel: +p.del, canReport: +p.report, canViewall: +p.viewall })) });
  }
  report.unknownMenus = [...unknownMenus];

  if (!dryRun) {
    for (const w of writes) {
      await prisma.$transaction([
        prisma.userMenu.deleteMany({ where: { userId: w.userId } }),
        ...(w.rows.length ? [prisma.userMenu.createMany({ data: w.rows.map((r) => ({ userId: w.userId, ...r, updatedAt: new Date() })) })] : []),
        prisma.funUser.update({ where: { userId: w.userId }, data: { menuAccess: null } }),
      ]);
      report.rowsWritten += w.rows.length;
      audit({ action: "user.perm_change", entityType: "user", entityId: w.userId, source: viaApi ? "api" : "web", ...(viaApi ? { actor: null } : {}), detail: "import", after: Object.fromEntries(w.rows.map((r) => [r.menuKey, r])) });
    }
  }
  return NextResponse.json({ ok: true, dryRun, ...report });
}
