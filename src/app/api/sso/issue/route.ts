import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { checkApiToken, issueTicket, ssoConfig } from "@/lib/sso";

export const runtime = "nodejs";

/**
 * SPS → Lead FUN (docs/SPS_INTEGRATION.md §3.3): the DMS asks us for a
 * one-shot sign-in link for one of its users, then redirects the browser
 * there. Identity match: line_userid first (same LINE Login channel on both
 * sides), then dms_user_id.
 *
 *   POST /api/sso/issue   X-Api-Token   { line_userid?, dms_user_id?, target?: "/leads" }
 *   → { ok:true, sso_url, expires_at, user:{ fun_user_id, display_name } }
 */
export async function POST(request: NextRequest) {
  if (!checkApiToken(request.headers.get("x-api-token"))) {
    audit({ action: "auth.sso_issue", result: "denied", source: "sso", actor: null, req: request, detail: "bad api token (in)" });
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "bad X-Api-Token" } }, { status: 401 });
  }
  const b = (await request.json().catch(() => ({}))) as { line_userid?: unknown; dms_user_id?: unknown; target?: unknown };
  const lineUserid = typeof b.line_userid === "string" ? b.line_userid.trim() : "";
  const dmsUserId = Number.isInteger(b.dms_user_id) ? (b.dms_user_id as number) : null;
  if (!lineUserid && dmsUserId === null) {
    return NextResponse.json({ ok: false, error: { code: "BAD_REQUEST", message: "line_userid or dms_user_id required" } }, { status: 400 });
  }
  const user =
    (lineUserid ? await prisma.funUser.findFirst({ where: { lineUserid } }) : null) ??
    (dmsUserId !== null ? await prisma.funUser.findUnique({ where: { dmsUserId } }) : null);
  if (!user) {
    audit({ action: "auth.sso_issue", result: "denied", source: "sso", actor: null, req: request, detail: `USER_UNMAPPED line=${lineUserid ? "y" : "n"} dms=${dmsUserId ?? "-"}` });
    return NextResponse.json({ ok: false, error: { code: "USER_UNMAPPED", message: "no Ch.Lead FUN user for this identity" } }, { status: 404 });
  }
  if (user.isActive !== 1 || !user.approvedAt) {
    audit({ action: "auth.sso_issue", result: "denied", source: "sso", actor: { userId: user.userId }, req: request, detail: "USER_INACTIVE" });
    return NextResponse.json({ ok: false, error: { code: "USER_INACTIVE", message: "user inactive or unapproved" } }, { status: 403 });
  }
  // Only same-origin paths — never an absolute URL from the caller.
  const rawTarget = typeof b.target === "string" ? b.target : "/leads";
  const target = rawTarget.startsWith("/") && !rawTarget.startsWith("//") ? rawTarget.slice(0, 100) : "/leads";

  const { ticket, expiresAt } = await issueTicket({ direction: "in", userId: user.userId, target });
  const { appUrl } = ssoConfig();
  audit({ action: "auth.sso_issue", source: "sso", req: request, actor: { userId: user.userId, name: user.displayName, role: user.role }, entityType: "user", entityId: user.userId, detail: `in ← SPS → ${target}` });
  return NextResponse.json({
    ok: true,
    sso_url: `${appUrl}/sso?ticket=${encodeURIComponent(ticket)}`,
    expires_at: expiresAt,
    user: { fun_user_id: user.userId, display_name: user.displayName },
  });
}
