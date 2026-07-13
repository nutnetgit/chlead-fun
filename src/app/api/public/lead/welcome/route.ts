import { NextRequest, NextResponse } from "next/server";
import { deliverWelcomeByPush, verifyWelcomeSig } from "@/lib/welcome";

/**
 * Paid-push fallback for the reply-token welcome flow (user req 2026-07-14,
 * see src/lib/welcome.ts). The LIFF page calls this ONLY when its
 * liff.sendMessages() marker failed (customer not a friend of the OA yet,
 * LINE client quirk, etc.) — without the marker there's no reply token, so
 * the greeting has to go out the old way as a push.
 *
 * Public (customers aren't signed in), guarded by the HMAC the register
 * response handed out — leadId alone can't trigger a push.
 * Body: { leadId, sig }
 */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as { leadId?: string | number; sig?: string };
  const leadIdRaw = b.leadId;
  if ((typeof leadIdRaw !== "string" && typeof leadIdRaw !== "number") || typeof b.sig !== "string") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  let leadId: bigint;
  try { leadId = BigInt(leadIdRaw); } catch { return NextResponse.json({ error: "bad id" }, { status: 400 }); }

  if (!verifyWelcomeSig(leadId, b.sig)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const pushed = await deliverWelcomeByPush(leadId);
  return NextResponse.json({ ok: true, pushed });
}
