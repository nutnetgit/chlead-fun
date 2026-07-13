import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { prisma } from "@/lib/prisma";

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
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, funUserId, role };
}

/**
 * Lead-scoped access gate (2026-07-13 permission audit: the lead LIST was
 * owner-scoped for sales, but the per-lead detail/mutation routes — GET/PATCH
 * /api/leads/[id], activity, summarize, switch-brand — had no check at all,
 * so any signed-in sales could read or modify any other salesperson's lead
 * across every brand/branch just by iterating ids). Same rule the chat/quote
 * routes already used: sales only their own leads; manager+ any lead.
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
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
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
