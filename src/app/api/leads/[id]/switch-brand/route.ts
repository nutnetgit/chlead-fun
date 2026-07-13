import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireLeadAccess } from "@/lib/authz";
import { linePush } from "@/lib/flex";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Cross-brand transfer (design approved 2026-07-08). The multibrand play:
 * customer comparing e.g. Mitsu vs Mazda closes on the other brand WITHOUT
 * losing the salesperson or the funnel truth.
 *   - OLD lead → status lost + reason group 'switched_brand' (excluded from
 *     real lost analytics — it's an internal save, its own metric)
 *   - NEW lead in the target brand/branch: same person, SAME OWNER (credit
 *     follows the salesperson → their manager), carries stage/temperature/
 *     payment context, links back via origin_lead_id
 *   - Permission model: ownership grants lead-scoped access — the salesperson
 *     works this one lead without gaining brand-wide visibility
 *   - Guardrail = visibility, not approval: both branches' managers get a
 *     LINE DM instantly; everything is logged append-only
 * Body: { brandId, branchId, modelId?, colorName?, note?, byUserId? }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const leadId = BigInt(id || "0");
  const access = await requireLeadAccess(leadId);
  if (!access.ok) return access.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const brandId = Number(b.brandId);
  const branchId = Number(b.branchId);
  if (!Number.isInteger(brandId) || !Number.isInteger(branchId)) {
    return NextResponse.json({ error: "missing brandId/branchId" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { leadId }, include: { person: true, brand: true } });
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (lead.brandId === brandId) return NextResponse.json({ error: "ยี่ห้อเดิมอยู่แล้ว" }, { status: 400 });

  const [brand, branch, model, switchedReason] = await Promise.all([
    prisma.brand.findUnique({ where: { brandId } }),
    prisma.branch.findUnique({ where: { branchId } }),
    b.modelId ? prisma.vehicleModel.findUnique({ where: { modelId: Number(b.modelId) } }) : Promise.resolve(null),
    prisma.lostReason.findFirst({ where: { reasonGroup: "switched_brand" } }),
  ]);
  if (!brand || !branch) return NextResponse.json({ error: "ไม่พบแบรนด์/สาขาปลายทาง" }, { status: 400 });

  const byUserId = typeof b.byUserId === "number" ? b.byUserId : null;
  const note = typeof b.note === "string" ? b.note.trim() : "";

  // 1. New lead in the target brand — same person, same owner, context carried.
  const newLead = await prisma.lead.create({
    data: {
      personId: lead.personId,
      branchId, brandId,
      channelId: lead.channelId,        // origin attribution stays true
      campaignId: lead.campaignId,
      interestedModelId: model?.modelId ?? null,
      interestedVariant: model?.modelName ?? null,
      interestedColor: typeof b.colorName === "string" ? b.colorName.trim() || null : null,
      paymentType: lead.paymentType,
      budgetMin: lead.budgetMin, budgetMax: lead.budgetMax,
      buyTimeframe: lead.buyTimeframe,
      hasTradein: lead.hasTradein,
      stage: lead.stage === "new" ? "new" : lead.stage,   // deal continues mid-flight
      temperature: lead.temperature,
      ownerUserId: lead.ownerUserId,
      status: "active",
      originLeadId: lead.leadId,
      nextActionAt: new Date(),
    },
  });
  await prisma.leadStageHistory.create({
    data: { leadId: newLead.leadId, fromStage: null, toStage: newLead.stage, changedBy: byUserId, note: `ย้ายยี่ห้อจาก ${lead.brand.brandName} (Lead #${Number(lead.leadId)})` },
  });
  await prisma.activity.create({
    data: {
      leadId: newLead.leadId, activityType: "note", direction: "internal",
      summary: `รับช่วงจาก Lead ${lead.brand.brandName} #${Number(lead.leadId)} (ลูกค้าเทียบแล้วเลือก ${brand.brandName})`,
      detail: note || null, createdBy: byUserId,
    },
  });

  // 2. Close the old lead as an internal switch (not a real loss).
  await prisma.lead.update({
    where: { leadId },
    data: { status: "lost", stage: "lost", lostReasonId: switchedReason?.reasonId ?? null },
  });
  await prisma.leadStageHistory.create({
    data: { leadId, fromStage: lead.stage, toStage: "lost", changedBy: byUserId, note: `ย้ายไปจบที่ ${brand.brandName} (Lead ใหม่ #${Number(newLead.leadId)})` },
  });

  // 3. Visibility guardrail: DM managers of BOTH branches.
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";
  const custName = lead.person.nickname || lead.person.firstName || "ลูกค้า";
  const owner = lead.ownerUserId ? await prisma.funUser.findUnique({ where: { userId: lead.ownerUserId } }) : null;
  if (lineToken) {
    const managers = await prisma.funUser.findMany({
      where: {
        role: { in: ["manager", "gm"] }, isActive: 1, lineUserid: { not: null },
        OR: [
          { branchId: { in: [lead.branchId, branchId] } },
          { branchLinks: { some: { branchId: { in: [lead.branchId, branchId] } } } },
        ],
      },
    });
    const msg = `🔁 ย้ายยี่ห้อ: ${custName}\n${lead.brand.brandName} → ${brand.brandName} (${branch.branchName})\nเซลส์: ${owner?.displayName ?? "ไม่ระบุ"}${note ? `\nเหตุผล: ${note}` : ""}\nLead ใหม่ #${Number(newLead.leadId)}`;
    for (const mgr of managers) {
      if (mgr.lineUserid) await linePush(lineToken, mgr.lineUserid, [{ type: "text", text: msg }]);
    }
  }

  return NextResponse.json({ ok: true, newLeadId: Number(newLead.leadId) }, { status: 201 });
}
