import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { handleSlaPostback, type PostbackAction } from "@/lib/governance";
import { getLineCredsForBrand } from "@/lib/lineConfig";
import { linePush } from "@/lib/flex";

/**
 * Web-side twin of the LINE SLA-escalate card buttons (dashboard Action Zone,
 * user req 2026-07-11: manager acts from the dashboard without hunting for
 * the LINE message). Same handleSlaPostback() logic; actor comes from the
 * session instead of a LINE userId lookup. "exempt" isn't offered here — the
 * dashboard links straight to /governance/exempt (which collects the
 * mandatory written reason) instead of round-tripping a deep link.
 */
const WEB_ACTIONS = new Set<PostbackAction>(["nudge_again", "reassign"]);

export async function POST(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as { action?: string; leadId?: number };
  const action = b.action as PostbackAction;
  if (!WEB_ACTIONS.has(action) || !b.leadId) {
    return NextResponse.json({ error: "bad action/leadId" }, { status: 400 });
  }

  // funUserId is null only in auth-disabled mode — governance actions still
  // work there (soft-launch parity with the rest of the app), just unattributed.
  const result = await handleSlaPostback(action, BigInt(b.leadId), rq.funUserId ?? 0);

  // Per-brand OA (user req 2026-07-15 — retire the single legacy channel
  // everywhere; this was the last staff-facing push still hardcoded to it).
  if (result.pushToOwner) {
    const creds = await getLineCredsForBrand(result.pushToOwner.brandId);
    if (creds.accessToken) {
      await linePush(creds.accessToken, result.pushToOwner.lineUserid, [{ type: "text", text: result.pushToOwner.text }]).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, message: result.replyText });
}
