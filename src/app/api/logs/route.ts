import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// System log (admin/gm) — merged timeline from the append-only tables the
// system already writes (no separate audit table needed yet): stage changes,
// activities, SLA events, assignment changes, AI nudges.
export async function GET() {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const [stages, activities, slaEvents, assigns, nudges, leads, users] = await Promise.all([
    prisma.leadStageHistory.findMany({ orderBy: { historyId: "desc" }, take: 60 }),
    prisma.activity.findMany({ orderBy: { activityId: "desc" }, take: 60 }),
    prisma.slaEvent.findMany({ orderBy: { eventId: "desc" }, take: 40 }),
    prisma.assignmentHistory.findMany({ orderBy: { assignId: "desc" }, take: 30 }),
    prisma.nudgeLog.findMany({ orderBy: { nudgeId: "desc" }, take: 30 }),
    prisma.lead.findMany({ include: { person: true } }),
    prisma.funUser.findMany(),
  ]);
  const leadName = new Map(leads.map((l) => [String(l.leadId), l.person.nickname || l.person.firstName || `#${l.leadId}`]));
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));
  const nm = (id: bigint) => leadName.get(String(id)) ?? `#${id}`;
  const un = (id: number | null) => (id ? userName.get(id) ?? `#${id}` : null);

  const STAGE_TH: Record<string, string> = {
    new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรอง", appointment: "นัดหมาย",
    test_drive: "ทดลองขับ", negotiation: "ต่อรอง", finance_check: "ไฟแนนซ์", booking: "จอง",
    nurture: "เลี้ยงต่อ", lost: "เสีย", forfeited: "ถูกริบ",
  };

  type Item = { at: string; kind: string; text: string; by: string | null };
  const items: Item[] = [
    ...stages.map((s) => ({
      at: s.changedAt?.toISOString() ?? "", kind: "stage",
      text: `${nm(s.leadId)}: ${s.fromStage ? (STAGE_TH[s.fromStage] ?? s.fromStage) + " → " : ""}${STAGE_TH[s.toStage] ?? s.toStage}${s.note ? ` (${s.note})` : ""}`,
      by: un(s.changedBy),
    })),
    ...activities.map((a) => ({
      at: a.createdAt?.toISOString() ?? "", kind: "activity",
      text: `${nm(a.leadId)}: ${a.summary ?? a.activityType}`,
      by: un(a.createdBy),
    })),
    ...slaEvents.map((e) => ({
      at: e.detectedAt?.toISOString() ?? "", kind: "sla",
      text: `${nm(e.leadId)}: SLA ${e.eventType}${e.resolvedAt ? ` (แก้แล้ว: ${e.resolution})` : " (ยังไม่แก้)"}`,
      by: un(e.exemptedBy),
    })),
    ...assigns.map((a) => ({
      at: a.assignedAt?.toISOString() ?? "", kind: "assign",
      text: `${nm(a.leadId)}: ${un(a.fromUserId) ?? "pool"} → ${un(a.toUserId) ?? "pool"} (${a.reason})`,
      by: un(a.assignedBy),
    })),
    ...nudges.map((n) => ({
      at: n.pushedAt?.toISOString() ?? "", kind: "aira",
      text: `${nm(n.leadId)}: น้องไอราร่างข้อความ (${n.triggerType})${n.salesAction ? ` · เซลส์: ${n.salesAction}` : ""}`,
      by: null,
    })),
  ].filter((i) => i.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120);

  return NextResponse.json(items);
}
