import { NextRequest, NextResponse } from "next/server";
import { runNudgeJob } from "@/lib/jobs/nudge";

export const runtime = "nodejs";

/**
 * Morning nudge — HTTP entry point for manual/ops triggering. The in-app
 * hourly scheduler (src/instrumentation.ts) calls runNudgeJob() directly
 * in-process; this route stays for manual testing / external callers.
 * Auth: x-api-key == WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  if (process.env.WEBHOOK_SECRET && request.headers.get("x-api-key") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runNudgeJob();
  if (result.ok) return NextResponse.json(result);
  const noKeyErrors = new Set(["GEMINI_API_KEY not set", "LINE token not set"]);
  const status = "error" in result && result.error && noKeyErrors.has(result.error) ? 503 : 502;
  return NextResponse.json(result, { status });
}
