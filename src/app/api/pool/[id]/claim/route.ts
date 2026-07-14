import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Claim a pool entry for a salesperson (handoff §5: forfeited/reassigned
// leads "แจกต่อภายใน 24 ชม."). Body: { userId?: number }.
// Identity comes from the session (2026-07-13 permission audit — the body
// used to carry claimedBy freely, letting any signed-in user claim as
// anyone): sales always claim for THEMSELVES (body userId ignored);
// manager+ may pass userId to assign on someone's behalf.
export async function POST(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const poolId = Number(id);
  if (!Number.isInteger(poolId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { userId?: number };
  const newOwnerId = rq.role === "sales" ? rq.funUserId : (typeof body.userId === "number" ? body.userId : rq.funUserId);
  if (!newOwnerId) return NextResponse.json({ error: "missing userId" }, { status: 400 });
  const claimedBy = rq.funUserId ?? newOwnerId;

  const pool = await prisma.leadPool.findUnique({ where: { poolId } });
  if (!pool) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pool.claimedAt) return NextResponse.json({ error: "already claimed" }, { status: 409 });

  // Restore the lead to a WORKING stage (user-reported bug 2026-07-14: after
  // claiming, the lead never appeared on the new owner's board — status went
  // back to "active" but stage stayed "forfeited", which no kanban column
  // shows and no working view lists). Resume from where it was when it got
  // forfeited (the forfeit history row's fromStage), falling back to "new".
  const forfeitHistory = await prisma.leadStageHistory.findFirst({
    where: { leadId: pool.leadId, toStage: "forfeited" },
    orderBy: { historyId: "desc" },
  });
  const lead = await prisma.lead.findUnique({ where: { leadId: pool.leadId } });
  // Only resume to a stage the working board actually shows — anything else
  // recorded in history (lost/nurture/forfeited itself) resets to "new".
  const WORKING_STAGES = new Set(["new", "contacted", "qualified", "appointment", "test_drive", "negotiation", "finance_check", "booking"]);
  const from = forfeitHistory?.fromStage;
  const resumeStage = (from && WORKING_STAGES.has(from) ? from : "new") as "new";
  const now = new Date();
  await prisma.$transaction([
    prisma.leadPool.update({ where: { poolId }, data: { claimedBy, claimedAt: now } }),
    // nextActionAt = now so it lands in the new owner's "due today" view
    // immediately — a claimed lead is exactly the thing to act on first.
    prisma.lead.update({
      where: { leadId: pool.leadId },
      data: { ownerUserId: newOwnerId, status: "active", stage: resumeStage, nextActionAt: now },
    }),
    prisma.leadStageHistory.create({
      data: { leadId: pool.leadId, fromStage: lead?.stage ?? "forfeited", toStage: resumeStage, changedBy: claimedBy, note: "pool claim — resume working stage" },
    }),
    prisma.assignmentHistory.create({
      data: { leadId: pool.leadId, fromUserId: null, toUserId: newOwnerId, reason: "load_balance", assignedBy: claimedBy },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
