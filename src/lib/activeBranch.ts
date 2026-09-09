import { cookies } from "next/headers";
import { visibleBranches } from "@/lib/authz";

/**
 * "สาขาที่กำลังทำงานอยู่" (user req 2026-09-09, same design as CPT's
 * active-branch.ts): a cookie remembers which of the user's visible branches
 * they are currently working as — the header switcher sets it, new leads /
 * events default to it, and the SPS handoff reports it. It is NOT a data
 * filter (lists stay scoped by permissions; the per-page BranchPicker does
 * the filtering) — exactly CPT's split between "working branch" and
 * "ทุกสาขา (N)" pickers.
 *
 * Resolution order: cookie (if still visible) → home branch → first visible.
 * The cookie is only a preference; every read re-validates it against
 * visibleBranches so a revoked branch silently falls back instead of leaking.
 */
export const ACTIVE_BRANCH_COOKIE = "fun_active_branch";

export type ActiveBranchContext = {
  activeBranchId: number | null;
  activeBranchName: string | null;
  branches: { branchId: number; branchName: string; brandName: string | null }[];
};

export async function getActiveBranchContext(funUserId: number | null, role: string | null, homeBranchId: number | null): Promise<ActiveBranchContext> {
  const branches = await visibleBranches(funUserId, role);
  let wanted: number | null = null;
  try {
    const raw = (await cookies()).get(ACTIVE_BRANCH_COOKIE)?.value;
    if (raw && Number.isInteger(Number(raw))) wanted = Number(raw);
  } catch { /* no request context (jobs) → fall through */ }
  const pick =
    branches.find((b) => b.branchId === wanted) ??
    branches.find((b) => b.branchId === homeBranchId) ??
    branches[0] ??
    null;
  return { activeBranchId: pick?.branchId ?? null, activeBranchName: pick?.branchName ?? null, branches };
}

// Links for the user menu's "สลับไประบบอื่นของ ช.เอราวัณ" section (CPT
// user-menu.tsx parity). SPS has no SSO into it without a lead yet (see
// docs/SPS_INTEGRATION.md §3) so it opens the legacy login in a new tab;
// CPT only appears once its URL is configured.
export function otherSystems(): { name: string; href: string; note: string }[] {
  const out: { name: string; href: string; note: string }[] = [];
  const sps = process.env.SPS_URL ?? "http://system.ch-erawan.com/sps/";
  out.push({ name: "SPS — Sales System", href: sps, note: "ล็อกอินใหม่" });
  if (process.env.CPT_URL) out.push({ name: "CPT — ประกัน/ทะเบียน", href: process.env.CPT_URL, note: "ล็อกอินใหม่" });
  return out;
}
