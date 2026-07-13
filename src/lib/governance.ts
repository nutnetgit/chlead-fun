import { prisma } from "@/lib/prisma";

export type PostbackAction = "nudge_again" | "reassign" | "exempt";

export type PostbackResult = {
  replyText: string;
  pushToOwner?: { lineUserid: string; text: string };
};

const APP_URL = process.env.APP_PUBLIC_URL || "https://fun.ch-erawan.com";

/**
 * Handle a tap on the manager's SLA-escalate card (handoff §5 playbook — the
 * 3-button flow: [เตือนอีกครั้ง][ย้ายเซลส์][ยกเว้น]). `actorUserId` is the
 * fun_user row for whoever tapped (resolved by lineUserid before calling this
 * — governance actions are manager/gm only, enforced by the caller).
 */
export async function handleSlaPostback(action: PostbackAction, leadId: bigint, actorUserId: number): Promise<PostbackResult> {
  const lead = await prisma.lead.findUnique({ where: { leadId }, include: { person: true } });
  if (!lead) return { replyText: "ไม่พบ Lead นี้ในระบบแล้ว (อาจถูกจัดการไปแล้ว)" };

  const openEscalate = await prisma.slaEvent.findFirst({
    where: { leadId, eventType: "idle_escalate", resolvedAt: null },
  });

  const custName = lead.person.nickname || lead.person.firstName || "ลูกค้า";

  switch (action) {
    case "nudge_again": {
      // A manager-initiated reminder counts as a real touch for SLA purposes —
      // insert a note activity so the DB trigger resets last_activity_at,
      // giving the salesperson a fresh clock instead of re-escalating hourly.
      await prisma.activity.create({
        data: { leadId, activityType: "note", direction: "internal", summary: "ผจก. สั่งเตือนอีกครั้ง (SLA)", createdBy: actorUserId },
      });
      if (openEscalate) {
        await prisma.slaEvent.update({ where: { eventId: openEscalate.eventId }, data: { resolvedAt: new Date(), resolution: "sales_acted" } });
      }
      const owner = lead.ownerUserId ? await prisma.funUser.findUnique({ where: { userId: lead.ownerUserId } }) : null;
      return {
        replyText: `✅ ส่งเตือนอีกครั้งให้ ${owner?.displayName ?? "เซลส์"} แล้ว — Lead #${Number(leadId)} (${custName})`,
        pushToOwner: owner?.lineUserid
          ? { lineUserid: owner.lineUserid, text: `⏰ ผจก. เตือนให้ติดตามลูกค้าด่วน\nLead #${Number(leadId)} — ${custName}\nกรุณาติดต่อภายในวันนี้` }
          : undefined,
      };
    }

    case "reassign": {
      // Return to the pool for someone else to claim (handoff §5: "ย้ายให้เซลส์อื่น").
      // No target salesperson is chosen here — a Flex button tap can't offer a
      // picker; claiming happens on the /pool page.
      const fromUserId = lead.ownerUserId;
      await prisma.$transaction([
        prisma.lead.update({ where: { leadId }, data: { ownerUserId: null } }),
        prisma.leadPool.create({ data: { leadId, enteredReason: "forfeited", priority: lead.temperature === "hot" ? 2 : lead.temperature === "warm" ? 1 : 0 } }),
        prisma.assignmentHistory.create({ data: { leadId, fromUserId, toUserId: null, reason: "manual_by_manager", assignedBy: actorUserId } }),
      ]);
      if (openEscalate) {
        await prisma.slaEvent.update({ where: { eventId: openEscalate.eventId }, data: { resolvedAt: new Date(), resolution: "manager_reassigned" } });
      }
      return { replyText: `🔁 ย้าย Lead #${Number(leadId)} (${custName}) เข้า pool แล้ว — รอเซลส์คนอื่น claim ที่ ${APP_URL}/pool` };
    }

    case "exempt": {
      // Exemption requires a mandatory reason (ADR-010/011) which a button tap
      // can't collect — send a deep link to a small web form instead.
      return { replyText: `📝 กรุณาระบุเหตุผลที่หน้านี้: ${APP_URL}/governance/exempt?lead=${Number(leadId)}` };
    }
  }
}

/** Web-form completion of the "exempt" action — requires a written reason. */
export async function exemptLead(leadId: bigint, reason: string, exemptedByUserId: number): Promise<{ ok: boolean; error?: string }> {
  if (!reason.trim()) return { ok: false, error: "ต้องระบุเหตุผล" };
  const openEscalate = await prisma.slaEvent.findFirst({ where: { leadId, eventType: "idle_escalate", resolvedAt: null } });
  if (!openEscalate) return { ok: false, error: "ไม่พบ SLA breach ที่ยังไม่แก้ไขสำหรับ Lead นี้" };
  await prisma.slaEvent.update({
    where: { eventId: openEscalate.eventId },
    data: { resolvedAt: new Date(), resolution: "exempted", exemptedBy: exemptedByUserId },
  });
  await prisma.activity.create({
    data: { leadId, activityType: "sla_override", direction: "internal", summary: "ผจก. ยกเว้น SLA breach", detail: reason.trim(), createdBy: exemptedByUserId },
  });
  return { ok: true };
}
