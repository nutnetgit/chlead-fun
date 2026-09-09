import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireRole, visibleBranches } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { ACTIVE_BRANCH_COOKIE } from "@/lib/activeBranch";

export const runtime = "nodejs";

// Header branch switcher (user req 2026-09-09, CPT branch-actions.ts parity):
// POST { branchId } → remembered in a cookie, but ONLY if it's one of the
// caller's visible branches — anything else is refused, never stored.
export async function POST(request: NextRequest) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;
  const b = (await request.json().catch(() => ({}))) as { branchId?: unknown };
  const branchId = Number(b.branchId);
  if (!Number.isInteger(branchId)) return NextResponse.json({ error: "bad branchId" }, { status: 400 });

  const allowed = await visibleBranches(rq.funUserId, rq.role);
  const target = allowed.find((x) => x.branchId === branchId);
  if (!target) {
    audit({ action: "perm.denied", result: "denied", entityType: "branch", entityId: branchId, detail: "switch to branch outside scope" });
    return NextResponse.json({ error: "ไม่มีสิทธิ์ทำงานในนามสาขานี้" }, { status: 403 });
  }
  (await cookies()).set(ACTIVE_BRANCH_COOKIE, String(branchId), {
    path: "/", sameSite: "lax", httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365,
  });
  audit({ action: "user.switch_branch", entityType: "branch", entityId: branchId, branchId, detail: target.branchName });
  return NextResponse.json({ ok: true, activeBranchId: branchId, activeBranchName: target.branchName });
}
