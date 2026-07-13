import { NextRequest, NextResponse } from "next/server";
import { ingestLead, type LeadInput, type IntakeSource } from "@/lib/leads";

export const runtime = "nodejs";

/**
 * Server-to-server lead intake, called by n8n WF1 (which owns the FB/LINE
 * secrets, verifies the Meta signature, and fetches the lead from the Graph
 * API). This endpoint does the DB work (channel lookup + upsert + dedupe/reopen)
 * and returns the built LINE Flex card for n8n to push. Auth: x-api-key must
 * equal WEBHOOK_SECRET (same pattern as CATS).
 *
 * Body: { source, pageId?, brand?, branchCode?, leadgenId?, customerName?,
 *         phone?, modelInterest?, budgetRange?, rawMessage?, consent? }
 */
const VALID_SOURCES = new Set<IntakeSource>([
  "facebook", "messenger", "line_oa", "walkin", "phone", "referral", "website",
]);

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-api-key");
  if (process.env.WEBHOOK_SECRET && key !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const source = String(body.source ?? "").toLowerCase() as IntakeSource;
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json({ ok: false, error: "invalid source" }, { status: 400 });
  }

  const input: LeadInput = {
    source,
    pageId: (body.pageId as string) ?? null,
    brand: (body.brand as string) ?? null,
    branchCode: (body.branchCode as string) ?? null,
    leadgenId: (body.leadgenId as string) ?? null,
    customerName: (body.customerName as string) ?? null,
    phone: (body.phone as string) ?? null,
    modelInterest: (body.modelInterest as string) ?? null,
    budgetRange: (body.budgetRange as string) ?? null,
    rawMessage: (body.rawMessage as string) ?? null,
    consent: Boolean(body.consent),
  };

  try {
    const result = await ingestLead(input);
    // ok:false (no active channel) is a 200 — n8n treats it as "drop silently".
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
