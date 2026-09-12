import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { hasPerm, resolvePerms, roleDefaultPerms, MENU_LABEL, PERM_FLAG_TH, type MenuKey, type PermFlag, type PermMap } from "@/lib/menuAccess";

/**
 * Server-side role gate for API routes (user req 2026-07-08 — an audit found
 * almost every route trusted the sidebar's UI hiding as its only access
 * control; e.g. PUT /api/users/[id] let any authenticated user grant
 * themselves admin). Use at the top of a route handler:
 *
 *   const rq = await requireRole(["admin", "gm"]);
 *   if (!rq.ok) return rq.response;
 *   // rq.funUserId / rq.role available here
 *
 * Bypasses entirely when auth is disabled (no AUTH_LINE_ID/AUTH_LINE_SECRET)
 * — matches middleware.ts's existing soft-launch behavior (auth is a no-op
 * app-wide until the LINE Login channel is configured), so this doesn't lock
 * out the current pre-launch deployment state.
 */
type RoleCheck =
  | { ok: true; funUserId: number | null; role: string | null }
  | { ok: false; response: NextResponse };

export async function requireRole(allowed: string[]): Promise<RoleCheck> {
  if (!authEnabled) return { ok: true, funUserId: null, role: null };

  const session = await auth();
  const u = session?.user as Record<string, unknown> | undefined;
  const funUserId = typeof u?.funUserId === "number" ? u.funUserId : null;
  const role = typeof u?.role === "string" ? u.role : null;

  if (!funUserId || !role) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!allowed.includes(role)) {
    audit({ action: "perm.denied", result: "denied", detail: `role ${role} not in [${allowed.join(",")}]` });
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, funUserId, role };
}

/**
 * Effective 6-flag permission map for a user (fun_user_menu rows, or the
 * role's default matrix when the user has none — see menuAccess.ts).
 */
export async function loadPerms(funUserId: number, role: string): Promise<PermMap> {
  const rows = await prisma.userMenu.findMany({ where: { userId: funUserId } });
  return resolvePerms(role, rows);
}

/**
 * Per-menu, per-action gate (user req 2026-09-09 — legacy SPS user_menu
 * semantics). `flag` omitted = just needs to be able to VIEW the menu.
 *
 *   const rq = await requirePerm("leads", "add");
 *   if (!rq.ok) return rq.response;
 *   // rq.perms available for further checks (e.g. hasPerm(rq.perms, "leads", "viewall"))
 *
 * Admin is never gated (the role that fixes permissions can't lock itself
 * out). Denials are audited.
 */
type PermCheck =
  | { ok: true; funUserId: number | null; role: string | null; perms: PermMap }
  | { ok: false; response: NextResponse };

export async function requirePerm(menuKey: MenuKey, flag?: PermFlag): Promise<PermCheck> {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq;
  if (!authEnabled || rq.funUserId === null || rq.role === null) {
    return { ok: true, funUserId: rq.funUserId, role: rq.role, perms: roleDefaultPerms("admin") };
  }
  const perms = rq.role === "admin" ? roleDefaultPerms("admin") : await loadPerms(rq.funUserId, rq.role);
  if (!hasPerm(perms, menuKey, flag)) {
    const what = `${MENU_LABEL[menuKey]}${flag ? " · " + PERM_FLAG_TH[flag] : ""}`;
    audit({ action: "perm.denied", result: "denied", entityType: "menu", entityId: menuKey, detail: what });
    return { ok: false, response: NextResponse.json({ error: `ไม่มีสิทธิ์: ${what}` }, { status: 403 }) };
  }
  return { ok: true, funUserId: rq.funUserId, role: rq.role, perms };
}

/**
 * Lead-scoped access gate (2026-07-13 permission audit: the lead LIST was
 * owner-scoped for sales, but the per-lead detail/mutation routes — GET/PATCH
 * /api/leads/[id], activity, summarize, switch-brand — had no check at all,
 * so any signed-in sales could read or modify any other salesperson's lead
 * across every brand/branch just by iterating ids). Same rule the chat/quote
 * routes already used: sales only their own leads; manager+ any lead.
 *
 * 2026-09-09: a sales user granted `leads.viewall` sees every lead in the
 * branches they belong to (legacy "เห็นทุกรายการ" semantics), not just their own.
 */
type LeadAccess =
  | { ok: true; funUserId: number | null; role: string | null; lead: NonNullable<Awaited<ReturnType<typeof prisma.lead.findUnique>>> }
  | { ok: false; response: NextResponse };

export async function requireLeadAccess(leadId: bigint): Promise<LeadAccess> {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return { ok: false, response: rq.response };
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return { ok: false, response: NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 }) };
  if (rq.role === "sales" && lead.ownerUserId !== rq.funUserId) {
    const perms = await loadPerms(rq.funUserId!, rq.role);
    const branches = hasPerm(perms, "leads", "viewall") ? await managerAllowedBranchIds(rq.funUserId!) : [];
    if (!branches.includes(lead.branchId)) {
      audit({ action: "perm.denied", result: "denied", entityType: "lead", entityId: leadId, detail: "lead of another owner" });
      return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
  }
  // A manager is scoped to their own branches here too (security review
  // 2026-09-12: only `sales` was checked, so a manager could open or edit any
  // lead in any branch by guessing its id — the list endpoints have always
  // scoped them, this closes the by-id door to match). `viewall` lifts it,
  // exactly like the lists. A manager with no branch links at all keeps the
  // long-standing "sees everything" fallback rather than being locked out.
  if (rq.role === "manager") {
    const perms = await loadPerms(rq.funUserId!, rq.role);
    if (!hasPerm(perms, "leads", "viewall")) {
      const branches = await managerAllowedBranchIds(rq.funUserId!);
      if (branches.length && !branches.includes(lead.branchId)) {
        audit({ action: "perm.denied", result: "denied", entityType: "lead", entityId: leadId, detail: `lead of branch ${lead.branchId}, outside manager scope` });
        return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
      }
    }
  }
  return { ok: true, funUserId: rq.funUserId, role: rq.role, lead };
}

/**
 * Manager settings split (user req 2026-07-12): a manager can manage vehicle
 * models/colors, but only for brands they actually have branch access to
 * (via fun_user_branch → fun_branch.brand_id) — mirrors how a manager's
 * lead visibility is already scoped by branch elsewhere in the app. Callers
 * only need this for role==="manager" — admin/gm are unrestricted.
 */
export async function managerAllowedBrandIds(funUserId: number): Promise<number[]> {
  const links = await prisma.userBranch.findMany({
    where: { userId: funUserId },
    include: { branch: true },
  });
  const brandIds = [...new Set(links.map((l) => l.branch.brandId).filter((x): x is number => x !== null))];
  return brandIds;
}

/**
 * Branch-scoped write access for managers (user req 2026-07-13, first used
 * by /api/events): the branches a manager may act on = their fun_user_branch
 * links plus their own home branch (fun_user.branch_id) as a safety net for
 * accounts that were never given explicit links.
 */
export async function managerAllowedBranchIds(funUserId: number): Promise<number[]> {
  const [links, user] = await Promise.all([
    prisma.userBranch.findMany({ where: { userId: funUserId } }),
    prisma.funUser.findUnique({ where: { userId: funUserId } }),
  ]);
  const ids = new Set(links.map((l) => l.branchId));
  if (user?.branchId !== null && user?.branchId !== undefined) ids.add(user.branchId);
  return [...ids];
}

/**
 * Branch scope for a read (user req 2026-09-09): null = unscoped (gm/admin,
 * or a manager holding `viewall` on this menu — legacy "เห็นทุกสาขา"); a
 * number[] = restrict to these branches. Callers keep their existing
 * `branchScope ? { branchId: { in: branchScope } } : {}` shape.
 */
export async function branchScopeFor(rq: { funUserId: number | null; role: string | null }, menuKey: MenuKey, perms?: PermMap): Promise<number[] | null> {
  if (rq.role !== "manager" || rq.funUserId === null) return null;
  const p = perms ?? (await loadPerms(rq.funUserId, rq.role));
  if (hasPerm(p, menuKey, "viewall")) return null;
  const allowed = await managerAllowedBranchIds(rq.funUserId);
  return allowed.length ? allowed : null;
}

/**
 * Branch picker (user req 2026-09-09, same rule as CPT's
 * resolveIssuingBranch): a client-requested `?branchId=` may only NARROW
 * within the caller's scope — a branch outside it is rejected, never silently
 * widened or swapped. Returns the effective scope to use in the query.
 */
export async function requestedBranchScope(scope: number[] | null, requested: string | null):
  Promise<{ ok: true; scope: number[] | null } | { ok: false; response: NextResponse }> {
  if (!requested) return { ok: true, scope };
  const id = Number(requested);
  if (!Number.isInteger(id)) return { ok: false, response: NextResponse.json({ error: "bad branchId" }, { status: 400 }) };
  if (scope === null) {
    const b = await prisma.branch.findUnique({ where: { branchId: id }, select: { branchId: true } });
    if (!b) return { ok: false, response: NextResponse.json({ error: "ไม่พบสาขา" }, { status: 404 }) };
    return { ok: true, scope: [id] };
  }
  if (!scope.includes(id)) {
    audit({ action: "perm.denied", result: "denied", entityType: "branch", entityId: id, detail: "branch outside scope" });
    return { ok: false, response: NextResponse.json({ error: "ไม่มีสิทธิ์ดูสาขานี้" }, { status: 403 }) };
  }
  return { ok: true, scope: [id] };
}

/**
 * Branches the user can pick from (header badge + BranchPicker): admin/gm
 * every active branch; otherwise their links + home branch, falling back to
 * every active branch when they have none (matches the graceful rule the
 * list routes already use).
 */
export async function visibleBranches(funUserId: number | null, role: string | null): Promise<{ branchId: number; branchName: string; brandName: string | null }[]> {
  const all = await prisma.branch.findMany({ where: { isActive: 1 }, orderBy: [{ brandId: "asc" }, { branchName: "asc" }] });
  const brands = await prisma.brand.findMany();
  const brandName = new Map(brands.map((b) => [b.brandId, b.brandName]));
  const shape = (b: (typeof all)[number]) => ({ branchId: b.branchId, branchName: b.branchName, brandName: b.brandId ? brandName.get(b.brandId) ?? null : null });
  if (role === "admin" || role === "gm" || funUserId === null) return all.map(shape);
  const own = await managerAllowedBranchIds(funUserId);
  const mine = all.filter((b) => own.includes(b.branchId));
  return (mine.length ? mine : all).map(shape);
}
