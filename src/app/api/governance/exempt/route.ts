import { NextRequest, NextResponse } from "next/server";
import { exemptLead } from "@/lib/governance";
import { requireRole } from "@/lib/authz";

// Completes the "exempt" postback action (handoff §5/ADR-011: exemption
// always requires a written reason, always logged). Body: { leadId, reason }.
// Actor is the SESSION's own identity, not a client-supplied id (user req
// 2026-07-08 — an audit found this trusted whatever exemptedByUserId the
// client sent, letting anyone claim to be any manager). Safe to require a
// session here: this page already sits behind middleware.ts's login gate
// (not in PUBLIC_PREFIXES), so the manager must already be signed in to
// reach it regardless.
export async function POST(request: NextRequest) {
  const rq = await requireRole(["manager", "gm"]);
  if (!rq.ok) return rq.response;
  if (!rq.funUserId) {
    // Auth disabled app-wide (soft-launch) — exemption still needs a real
    // actor for the audit trail, so this is a hard requirement, not a bypass.
    return NextResponse.json({ ok: false, error: "ต้องเข้าสู่ระบบก่อนยกเว้น" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { leadId?: number; reason?: string };
  if (!body.leadId) {
    return NextResponse.json({ ok: false, error: "missing leadId" }, { status: 400 });
  }
  const result = await exemptLead(BigInt(body.leadId), body.reason ?? "", rq.funUserId);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
