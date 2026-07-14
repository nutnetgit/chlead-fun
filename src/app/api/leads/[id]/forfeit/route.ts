import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Manual "ริบ Lead เข้า pool" (user-reported 2026-07-14: no way in the web
 * app to send a lead back to the pool at all — the ONLY existing paths were
 * the hourly SLA idle-forfeit job and a manager tapping the SLA-escalate
 * LINE Flex card's button; nothing reachable from Lead Center). Mirrors
 * runSlaJob's forfeit block in src/lib/jobs/sla.ts exactly, just triggered
 * on demand instead of by an idle timer. Manager+ only — same reasoning as
 * every other ownership-changing action in this app.
 */
export async function POST(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const leadId = BigInt(id || "0");
  const lead = await prisma.lead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: "ไม่พบ Lead" }, { status: 404 });
  if (lead.status !== "active" && lead.status !== "nurture") {
    return NextResponse.json({ error: "ริบได้เฉพาะ Lead ที่ยังทำงานอยู่ (active/nurture)" }, { status: 409 });
  }

  // Reason strings must fit fun_lead_pool.entered_reason VARCHAR(15) and
  // fun_assignment_history.reason VARCHAR(20) — the original
  // "manual_manager_forfeit" (22 chars) overflowed BOTH columns, which
  // failed the whole transaction silently as "ริบไม่สำเร็จ" with no visible
  // reason (bug found 2026-07-14 via live test).
  const FORFEIT_PRIORITY: Record<string, number> = { hot: 2, warm: 1, cold: 0 };
  try {
    await prisma.$transaction([
      prisma.lead.update({ where: { leadId }, data: { status: "forfeited", stage: "forfeited", ownerUserId: null } }),
      prisma.leadPool.create({
        data: { leadId, enteredReason: "manager_forfeit", priority: FORFEIT_PRIORITY[lead.temperature ?? "cold"] ?? 0 },
      }),
      prisma.assignmentHistory.create({
        data: { leadId, fromUserId: lead.ownerUserId, toUserId: null, reason: "manager_forfeit", assignedBy: rq.funUserId },
      }),
      prisma.leadStageHistory.create({
        data: { leadId, fromStage: lead.stage, toStage: "forfeited", changedBy: rq.funUserId, note: "ริบด้วยตนเองจากหน้าศูนย์รวม Lead" },
      }),
    ]);
  } catch (e) {
    console.error(`[forfeit] lead=${leadId}:`, e);
    return NextResponse.json({ error: "ริบไม่สำเร็จ — เกิดข้อผิดพลาดที่เซิร์ฟเวอร์" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
