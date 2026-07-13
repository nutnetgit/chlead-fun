import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireLeadAccess } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TYPES = new Set([
  "call_out", "call_in", "line_msg", "fb_msg", "sms", "visit_showroom",
  "home_visit", "test_drive", "quote_sent", "note",
]);
const VALID_OUTCOMES = new Set([
  "reached", "no_answer", "busy", "wrong_number", "line_read", "line_no_read",
  "appointment_made", "interested", "considering", "not_interested", "asked_stop",
]);

/**
 * Quick-log from the workspace ("บันทึกการติดต่อ"): appends a fun_activity —
 * the DB trigger then updates last_activity_at / next_action_at /
 * first_response_at on the lead, which is what feeds the SLA engine.
 * Body: { activityType, outcome?, summary?, detail?, nextActionAt?, createdBy? }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const leadId = BigInt(id || "0");
  const access = await requireLeadAccess(leadId);
  if (!access.ok) return access.response;
  const lead = access.lead;

  const b = (await request.json().catch(() => ({}))) as {
    activityType?: string; outcome?: string; summary?: string; detail?: string;
    nextActionAt?: string; createdBy?: number;
  };
  if (!b.activityType || !VALID_TYPES.has(b.activityType)) {
    return NextResponse.json({ error: "invalid activityType" }, { status: 400 });
  }
  // Attribution comes from the session, not the client body — a stray/forged
  // createdBy can't pin an activity on someone else.
  const createdBy = access.funUserId ?? b.createdBy ?? null;

  const activity = await prisma.activity.create({
    data: {
      leadId,
      activityType: b.activityType as never,
      direction: "outbound",
      outcome: b.outcome && VALID_OUTCOMES.has(b.outcome) ? b.outcome : null,
      summary: b.summary?.slice(0, 255) || null,
      detail: b.detail || null,
      nextActionAt: b.nextActionAt ? new Date(b.nextActionAt) : null,
      createdBy,
    },
  });

  // A logged contact moves a brand-new lead forward automatically.
  if (lead.stage === "new") {
    await prisma.lead.update({ where: { leadId }, data: { stage: "contacted" } });
    await prisma.leadStageHistory.create({
      data: { leadId, fromStage: "new", toStage: "contacted", changedBy: createdBy, note: "auto: first logged contact" },
    });
  }

  return NextResponse.json({ ok: true, activityId: Number(activity.activityId) });
}
