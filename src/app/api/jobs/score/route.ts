import { NextRequest, NextResponse } from "next/server";
import { runScoreJob } from "@/lib/jobs/score";

export const runtime = "nodejs";

/**
 * Nightly AI scoring — HTTP entry point for manual/ops triggering. The in-app
 * hourly scheduler (src/instrumentation.ts) calls runScoreJob() directly
 * in-process; this route stays for manual testing / external callers.
 * Auth: x-api-key == WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  if (process.env.WEBHOOK_SECRET && request.headers.get("x-api-key") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runScoreJob();
  if (result.ok) return NextResponse.json(result);
  const status = "error" in result && result.error === "GEMINI_API_KEY not set" ? 503 : 502;
  return NextResponse.json(result, { status });
}
