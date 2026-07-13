import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

/**
 * Chat inbox list (user req 2026-07-08) — one row per lead that has at least
 * one fun_chat_message, most-recent-first, with a naive "unread" flag (latest
 * message is inbound — i.e. nothing outbound has answered it yet). Scoped
 * like /leads already is: sales sees only their own leads; manager/gm/admin
 * see everything. The "ไม่ทราบที่มา" bucket (messages from a LINE user we
 * couldn't resolve to any lead — never scanned a QR) is manager+ only, since
 * a sales user has no lead to triage it against anyway.
 */
export async function GET() {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const grouped = await prisma.chatMessage.groupBy({
    by: ["leadId"],
    where: { leadId: { not: null } },
  });
  const leadIds = grouped.map((g) => g.leadId).filter((x): x is bigint => x !== null);

  const leads = leadIds.length ? await prisma.lead.findMany({
    where: { leadId: { in: leadIds }, ...(rq.role === "sales" ? { ownerUserId: rq.funUserId } : {}) },
    include: { person: true, brand: true, branch: true },
  }) : [];

  const ownerIds = [...new Set(leads.map((l) => l.ownerUserId).filter((x): x is number => x !== null))];
  const owners = ownerIds.length ? await prisma.funUser.findMany({ where: { userId: { in: ownerIds } } }) : [];
  const ownerName = new Map(owners.map((o) => [o.userId, o.nickname || o.displayName]));
  const scopedLeadIds = leads.map((l) => l.leadId);

  const messages = scopedLeadIds.length ? await prisma.chatMessage.findMany({
    where: { leadId: { in: scopedLeadIds } },
    orderBy: { createdAt: "desc" },
  }) : [];
  const byLead = new Map<string, typeof messages>();
  for (const m of messages) {
    const key = String(m.leadId);
    if (!byLead.has(key)) byLead.set(key, []);
    byLead.get(key)!.push(m);
  }

  const conversations = leads.map((l) => {
    // msgs is newest-first (see the findMany orderBy above) — unread count is
    // how many inbound messages sit before the most recent outbound reply
    // (or all of them, if the salesperson has never replied at all).
    const msgs = byLead.get(String(l.leadId)) ?? [];
    const latest = msgs[0];
    let unreadCount = 0;
    for (const m of msgs) {
      if (m.direction === "outbound") break;
      unreadCount++;
    }
    return {
      leadId: Number(l.leadId),
      customerName: l.person.nickname || l.person.firstName || "ไม่ระบุชื่อ",
      pictureUrl: l.person.pictureUrl ?? null,
      brand: l.brand.brandName,
      branch: l.branch.branchCode ?? l.branch.branchName,
      ownerName: l.ownerUserId ? ownerName.get(l.ownerUserId) ?? null : null,
      lastMessage: latest?.body ?? null,
      lastMessageAt: latest?.createdAt ?? null,
      unreadCount,
    };
  }).sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));

  let unresolved: { lineUserId: string; lastMessage: string | null; lastMessageAt: Date | null }[] = [];
  if (rq.role !== "sales") {
    const unresolvedMsgs = await prisma.chatMessage.findMany({ where: { leadId: null }, orderBy: { createdAt: "desc" } });
    const byLineId = new Map<string, typeof unresolvedMsgs>();
    for (const m of unresolvedMsgs) {
      if (!byLineId.has(m.lineUserId)) byLineId.set(m.lineUserId, []);
      byLineId.get(m.lineUserId)!.push(m);
    }
    unresolved = [...byLineId.entries()].map(([lineUserId, msgs]) => ({
      lineUserId, lastMessage: msgs[0]?.body ?? null, lastMessageAt: msgs[0]?.createdAt ?? null,
    }));
  }

  return NextResponse.json({ conversations, unresolved });
}
