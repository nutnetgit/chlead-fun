import { NextRequest, NextResponse } from "next/server";
import { runChatExtractJob } from "@/lib/jobs/chatExtract";

export const runtime = "nodejs";

/**
 * Hourly chat-extract — HTTP entry point for manual/ops triggering. The
 * in-app hourly scheduler (src/instrumentation.ts) calls runChatExtractJob()
 * directly in-process; this route stays for manual testing/external callers.
 * Auth: x-api-key == WEBHOOK_SECRET (same pattern as the other job routes).
 */
export async function POST(request: NextRequest) {
  if (process.env.WEBHOOK_SECRET && request.headers.get("x-api-key") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result = await runChatExtractJob();
  if (result.ok) return NextResponse.json(result);
  const status = "error" in result && result.error === "GEMINI_API_KEY not set" ? 503 : 502;
  return NextResponse.json(result, { status });
}
