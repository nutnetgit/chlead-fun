import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

const DAY = 24 * 60 * 60 * 1000;

// Full lead detail for the workspace right panel: fields + activity timeline
// + the latest AI draft (fun_nudge_log) for the copy-and-send box.
export async function GET(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({
    where: { leadId },
    include: {
      person: true, brand: true, branch: true, channel: true,
      activities: { orderBy: { createdAt: "desc" }, take: 30 },
      nudges: { orderBy: { nudgeId: "desc" }, take: 1 },
    },
  });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const owner = lead.ownerUserId ? await prisma.funUser.findUnique({ where: { userId: lead.ownerUserId } }) : null;
  const phone = await prisma.personIdentifier.findFirst({
    where: { personId: lead.personId, idType: { in: ["phone", "phone2"] } },
  });
  // Quotation summary (user req 2026-07-13) — a section above the follow-up
  // timeline showing every PDF quote created for this lead, newest first,
  // so staff have somewhere in-app to reopen a past quote from.
  const quotes = await prisma.quotation.findMany({
    where: { leadId },
    orderBy: { createdAt: "desc" },
    select: { quoteId: true, quoteNo: true, createdAt: true, status: true, totalPrice: true },
  });

  return NextResponse.json({
    leadId: Number(lead.leadId),
    customerName: lead.person.nickname || lead.person.firstName || "ไม่ระบุชื่อ",
    fullName: [lead.person.prefix, lead.person.firstName, lead.person.lastName].filter(Boolean).join(" ") || null,
    phone: phone?.idValue ?? null,
    brand: lead.brand.brandName,
    brandId: lead.brandId,
    branch: lead.branch.branchName,
    channel: lead.channel.channelName,
    modelInterest: lead.interestedVariant,
    color: lead.interestedColor,
    paymentType: lead.paymentType,
    budgetMin: lead.budgetMin ? Number(lead.budgetMin) : null,
    budgetMax: lead.budgetMax ? Number(lead.budgetMax) : null,
    buyTimeframe: lead.buyTimeframe,
    hasTradein: !!lead.hasTradein,
    stage: lead.stage,
    temperature: lead.temperature,
    temperatureConflict: !!lead.temperatureConflict,
    aiScore: lead.aiScore,
    aiScoreReason: lead.aiScoreReason,
    ownerName: owner?.displayName ?? null,
    daysIdle: Math.floor((Date.now() - (lead.lastActivityAt ?? lead.createdAt ?? new Date()).getTime()) / DAY),
    nextActionAt: lead.nextActionAt,
    createdAt: lead.createdAt,
    archivedAt: lead.archivedAt,
    draft: lead.nudges[0]?.draftMessage ?? null,
    quotes: quotes.map((q) => ({
      quoteId: Number(q.quoteId),
      quoteNo: q.quoteNo ?? `#${Number(q.quoteId)}`,
      createdAt: q.createdAt,
      status: q.status,
      totalPrice: q.totalPrice ? Number(q.totalPrice) : null,
    })),
    timeline: lead.activities.map((a) => ({
      activityId: Number(a.activityId),
      at: a.createdAt,
      type: a.activityType,
      direction: a.direction,
      outcome: a.outcome,
      summary: a.summary,
      detail: a.detail,
    })),
  });
}

// Stage / temperature / archive updates from the workspace.
// Body: { stage?, temperature?, archived? }. Stage changes are logged
// append-only to fun_lead_stage_history. Archive is a soft-archive toggle
// (CATS candidate parity) — never deletes the row, just hides it from the
// default working views; a manager can un-archive at any time.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const leadId = BigInt(id || "0");
  const body = (await request.json().catch(() => ({}))) as { stage?: string; temperature?: string; archived?: boolean; changedBy?: number };

  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });

  const VALID_STAGES = new Set(["new", "contacted", "qualified", "appointment", "test_drive", "negotiation", "finance_check", "booking", "nurture", "lost"]);
  const VALID_TEMPS = new Set(["hot", "warm", "cold"]);
  const data: Record<string, unknown> = {};

  if (typeof body.archived === "boolean") {
    data.archivedAt = body.archived ? new Date() : null;
  }
  if (body.stage && VALID_STAGES.has(body.stage)) {
    data.stage = body.stage;
    if (body.stage === "lost") data.status = "lost";
    if (body.stage === "nurture") data.status = "nurture";
  }
  if (body.temperature && VALID_TEMPS.has(body.temperature)) {
    // Human explicitly (re)setting temperature clears the ADR-011 conflict flag —
    // it's a deliberate override; the next nightly score re-evaluates it.
    data.temperature = body.temperature;
    data.temperatureConflict = 0;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  await prisma.lead.update({ where: { leadId }, data });
  if (data.stage && data.stage !== lead.stage) {
    await prisma.leadStageHistory.create({
      data: { leadId, fromStage: lead.stage, toStage: String(data.stage), changedBy: body.changedBy ?? null },
    });
  }
  return NextResponse.json({ ok: true });
}

// Permanent delete (user req 2026-07-11) — only for leads already archived
// (matches how branches/brands/models are deleted: an explicit prior state,
// not a one-click destructive action from the normal working view). Wipes
// every table that references this lead — there's no FK-cascade in the raw
// SQL schema (sql/001 owns it, Prisma just mirrors), so each is cleared
// explicitly in one transaction before the lead row itself.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (!lead.archivedAt) {
    return NextResponse.json({ error: "ลบได้เฉพาะ Lead ที่เก็บเข้าคลังแล้ว — เก็บเข้าคลังก่อน" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { leadId } }),
    prisma.nudgeLog.deleteMany({ where: { leadId } }),
    prisma.leadPool.deleteMany({ where: { leadId } }),
    prisma.ownerSwitchRequest.deleteMany({ where: { leadId } }),
    prisma.assignmentHistory.deleteMany({ where: { leadId } }),
    prisma.slaEvent.deleteMany({ where: { leadId } }),
    prisma.bookingHandoff.deleteMany({ where: { leadId } }),
    prisma.tradeinAppraisal.deleteMany({ where: { leadId } }),
    prisma.financeApplication.deleteMany({ where: { leadId } }),
    prisma.quotation.deleteMany({ where: { leadId } }),
    prisma.appointment.deleteMany({ where: { leadId } }),
    prisma.activity.deleteMany({ where: { leadId } }),
    prisma.leadStageHistory.deleteMany({ where: { leadId } }),
    prisma.lead.delete({ where: { leadId } }),
  ]);
  return NextResponse.json({ ok: true });
}
