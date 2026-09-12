import { NextRequest, NextResponse } from "next/server";
import { runDigestJob } from "@/lib/jobs/digest";
import { checkWebhookKey } from "@/lib/apiKey";

export const runtime = "nodejs";

/**
 * Morning manager digest — HTTP entry point for manual/ops triggering. The
 * in-app hourly scheduler (src/instrumentation.ts) calls runDigestJob()
 * directly in-process; this route stays for manual testing / external callers.
 * Auth: x-api-key == WEBHOOK_SECRET (required; no secret set = nobody in).
 */
export async function POST(request: NextRequest) {
  if (!checkWebhookKey(request.headers.get("x-api-key"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runDigestJob());
}
