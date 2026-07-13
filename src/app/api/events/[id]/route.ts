import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

// Update event (name/dates/target + replace brands/targets when arrays sent).
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (typeof b.eventName === "string" && b.eventName.trim()) data.campaignName = b.eventName.trim();
  if (b.startDate) data.startDate = new Date(String(b.startDate));
  if (b.endDate) data.endDate = new Date(String(b.endDate));
  if (typeof b.targetLeads === "number" || b.targetLeads === null) data.targetLeads = b.targetLeads;
  if (typeof b.linePromoMessage === "string" || b.linePromoMessage === null) data.linePromoMessage = typeof b.linePromoMessage === "string" ? (b.linePromoMessage.trim() || null) : null;

  try {
    if (Object.keys(data).length) await prisma.campaign.update({ where: { campaignId }, data });
    if (Array.isArray(b.brandIds)) {
      const brandIds = b.brandIds.filter((x) => Number.isInteger(x)) as number[];
      await prisma.$transaction([
        prisma.campaignBrand.deleteMany({ where: { campaignId } }),
        ...(brandIds.length ? [prisma.campaignBrand.createMany({ data: brandIds.map((brandId) => ({ campaignId, brandId })) })] : []),
      ]);
    }
    if (Array.isArray(b.targets)) {
      const rows = (b.targets as { userId?: number; targetLeads?: number }[])
        .filter((t) => Number.isInteger(t.userId))
        .map((t) => ({ campaignId, userId: t.userId as number, targetLeads: Number(t.targetLeads) || 0 }));
      await prisma.$transaction([
        prisma.campaignTarget.deleteMany({ where: { campaignId } }),
        ...(rows.length ? [prisma.campaignTarget.createMany({ data: rows })] : []),
      ]);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบ event" }, { status: 404 });
  }
}

// Delete-if-unused: blocked once leads reference the event.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const leads = await prisma.lead.count({ where: { campaignId } });
  if (leads) return NextResponse.json({ error: `ลบไม่ได้ — มี Lead จาก event นี้ ${leads} ราย` }, { status: 409 });
  await prisma.$transaction([
    prisma.campaignBrand.deleteMany({ where: { campaignId } }),
    prisma.campaignTarget.deleteMany({ where: { campaignId } }),
    prisma.campaign.delete({ where: { campaignId } }),
  ]);
  return NextResponse.json({ ok: true });
}
