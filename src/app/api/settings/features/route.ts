import { NextRequest, NextResponse } from "next/server";
import { getFeatureFlags, setFeatureFlags } from "@/lib/settings";
import { requireRole } from "@/lib/authz";

// Feature switches (see src/lib/settings.ts). GET is open to every signed-in
// role — the flags decide which buttons render in staff-facing pages like
// /chat, so sales need to read them too. PUT is admin/gm only.
export async function GET() {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;
  return NextResponse.json(await getFeatureFlags());
}

export async function PUT(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as { quotationEnabled?: boolean; chatSendEnabled?: boolean };
  const next = await setFeatureFlags({
    ...(typeof b.quotationEnabled === "boolean" ? { quotationEnabled: b.quotationEnabled } : {}),
    ...(typeof b.chatSendEnabled === "boolean" ? { chatSendEnabled: b.chatSendEnabled } : {}),
  });
  return NextResponse.json({ ok: true, ...next });
}
