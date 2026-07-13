import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

// Claim a pool entry for a salesperson (handoff §5: forfeited/reassigned
// leads "แจกต่อภายใน 24 ชม."). Body: { userId: number, claimedBy: number }
// — claimedBy is who's performing the claim (may be a manager assigning on
// someone's behalf, or the salesperson themself); userId is who ends up owning it.
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const poolId = Number(id);
  if (!Number.isInteger(poolId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { userId?: number; claimedBy?: number };
  if (!body.userId) return NextResponse.json({ error: "missing userId" }, { status: 400 });

  const pool = await prisma.leadPool.findUnique({ where: { poolId } });
  if (!pool) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (pool.claimedAt) return NextResponse.json({ error: "already claimed" }, { status: 409 });

  const now = new Date();
  await prisma.$transaction([
    prisma.leadPool.update({ where: { poolId }, data: { claimedBy: body.claimedBy ?? body.userId, claimedAt: now } }),
    prisma.lead.update({ where: { leadId: pool.leadId }, data: { ownerUserId: body.userId, status: "active" } }),
    prisma.assignmentHistory.create({
      data: { leadId: pool.leadId, fromUserId: null, toUserId: body.userId, reason: "load_balance", assignedBy: body.claimedBy ?? body.userId },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
