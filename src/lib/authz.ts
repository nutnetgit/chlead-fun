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
