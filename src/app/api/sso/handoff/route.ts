import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm, requireLeadAccess } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { issueTicket, ssoConfig } from "@/lib/sso";

export const runtime = "nodejs";

/**
 * Lead FUN → SPS handoff (user req 2026-09-09): once a lead is จอง
 * (stage=booking) the salesperson opens SPS's booking form without logging
 * in again. We snapshot what SPS needs into fun_booking_handoff, mint a
 * single-use ticket, and hand back the SPS landing URL; SPS then calls
 * POST /api/sso/verify with that ticket (docs/SPS_INTEGRATION.md §3).
 *
 * Body: { leadId }
 */
export async function POST(request: NextRequest) {
  const rq = await requirePerm("leads", "edit");
  if (!rq.ok) return rq.response;
  const { landingUrl } = ssoConfig();
  if (!landingUrl) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า SPS_SSO_LANDING_URL" }, { status: 503 });
  if (rq.funUserId === null) return NextResponse.json({ error: "ต้องเข้าสู่ระบบ" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { leadId?: unknown };
  const leadId = BigInt(Number(body.leadId) || 0);
  const access = await requireLeadAccess(leadId);
  if (!access.ok) return access.response;
  if (access.lead.stage !== "booking") {
    return NextResponse.json({ error: "ต้องเปลี่ยนสถานะเป็น \"จองแล้ว\" ก่อนส่งต่อไป SPS" }, { status: 409 });
  }

  const [user, lead] = await Promise.all([
    prisma.funUser.findUnique({ where: { userId: rq.funUserId } }),
    prisma.lead.findUnique({ where: { leadId }, include: { person: { include: { identifiers: true } }, brand: true, branch: true } }),
  ]);
  if (!user || !lead) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });
  if (!user.lineUserid && !user.dmsUserId) {
    return NextResponse.json({ error: "บัญชีของคุณยังไม่ได้ผูกกับ SPS (ไม่มี LINE และไม่มีรหัสผู้ใช้ SPS) — แจ้งแอดมิน" }, { status: 409 });
  }

  const [model, quote] = await Promise.all([
    lead.interestedModelId ? prisma.vehicleModel.findUnique({ where: { modelId: lead.interestedModelId } }) : null,
    prisma.quotation.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } }),
  ]);
  const p = lead.person;
  const fullName = [p.prefix, p.firstName, p.lastName].filter(Boolean).join(" ") || p.nickname || null;
  const addr = [p.addrNo, p.addrStreet, p.addrTambon, p.addrAmphur, p.addrProvince, p.addrZip].filter(Boolean).join(" ") || null;
  const snapshot = {
    personId: lead.personId,
    customerFullname: fullName?.slice(0, 200) ?? null,
    customerAddrFull: addr,
    model: (model?.modelName ?? null)?.slice(0, 100) ?? null,
    variant: lead.interestedVariant,
    color: lead.interestedColor,
    agreedPrice: quote?.totalPrice ?? null,
    status: "ready",
    generatedBy: rq.funUserId,
    generatedAt: new Date(),
  };
  const handoff = await prisma.bookingHandoff.upsert({
    where: { leadId },
    create: { leadId, ...snapshot },
    update: snapshot,
  });

  const { ticket, expiresAt } = await issueTicket({ direction: "out", userId: user.userId, leadId, handoffId: handoff.handoffId });
  audit({ action: "auth.sso_issue", source: "sso", entityType: "lead", entityId: leadId, branchId: lead.branchId, detail: `out → SPS, handoff #${handoff.handoffId}` });

  const sep = landingUrl.includes("?") ? "&" : "?";
  return NextResponse.json({ ok: true, redirectUrl: `${landingUrl}${sep}ticket=${encodeURIComponent(ticket)}`, expiresAt, handoffId: Number(handoff.handoffId) });
}
