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

  const now = new Date();
  await prisma.$transaction([
    prisma.leadPool.update({ where: { poolId }, data: { claimedBy, claimedAt: now } }),
    prisma.lead.update({ where: { leadId: pool.leadId }, data: { ownerUserId: newOwnerId, status: "active" } }),
    prisma.assignmentHistory.create({
      data: { leadId: pool.leadId, fromUserId: null, toUserId: newOwnerId, reason: "load_balance", assignedBy: claimedBy },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
