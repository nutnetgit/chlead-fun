import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { checkApiToken } from "@/lib/sso";
import { MENU_DEFS, resolvePerms, type MenuKey } from "@/lib/menuAccess";

export const runtime = "nodejs";

/**
 * Permission export for the SPS/DMS team (user req 2026-09-09) — every user
 * with their effective 6-flag rows, plus the closest legacy SPS menu code
 * per menu so the DMS side can map onto `user_menu`. Contract in
 * docs/SPS_INTEGRATION.md §2.
 *
 * Auth: an admin session with settings·report, OR the SPS shared token
 * (X-Api-Token) for server-to-server pulls.
 */
export async function GET(request: NextRequest) {
  let viaApi = false;
  if (checkApiToken(request.headers.get("x-api-token"))) viaApi = true;
  else {
    const rq = await requirePerm("settings", "report");
    if (!rq.ok) return rq.response;
  }

  const [users, branches] = await Promise.all([
    prisma.funUser.findMany({ include: { menuRows: true }, orderBy: { userId: "asc" } }),
    prisma.branch.findMany(),
  ]);
  const branchCode = new Map(branches.map((b) => [b.branchId, b.branchCode ?? b.branchName]));
  const legacy = new Map(MENU_DEFS.map((m) => [m.key, m.legacyCode ?? null]));

  const payload = {
    exported_at: new Date().toISOString(),
    source: "chlead-fun",
    menus: MENU_DEFS.map((m) => ({ menu_key: m.key, label: m.label, legacy_code: m.legacyCode ?? null })),
    users: users.map((u) => {
      const perms = resolvePerms(u.role, u.menuRows);
      return {
        fun_user_id: u.userId,
        dms_user_id: u.dmsUserId,
        line_userid: u.lineUserid,
        username: u.username,
        display_name: u.displayName,
        role: u.role,
        is_active: u.isActive === 1,
        branch_code: u.branchId ? branchCode.get(u.branchId) ?? null : null,
        perm_source: u.menuRows.length ? "explicit" : "role_default",
        menus: (Object.keys(perms) as MenuKey[]).map((k) => ({
          menu_key: k, legacy_code: legacy.get(k) ?? null,
          add: +!!perms[k]!.add, edit: +!!perms[k]!.edit, cancel: +!!perms[k]!.cancel,
          del: +!!perms[k]!.del, report: +!!perms[k]!.report, viewall: +!!perms[k]!.viewall,
        })),
      };
    }),
  };
  audit({ action: "report.export", entityType: "permissions", source: viaApi ? "api" : "web", ...(viaApi ? { actor: null } : {}), detail: `${users.length} users` });
  return NextResponse.json(payload);
}
