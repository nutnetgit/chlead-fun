import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Events (manager-configured, stored in fun_campaign + junctions).
// ?active=1 → only events running today (for the sales QR picker).
// Metrics come along: actual lead counts per event and per salesperson.
export async function GET(request: NextRequest) {
  const activeOnly = request.nextUrl.searchParams.get("active") === "1";
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const events = await prisma.campaign.findMany({
    where: activeOnly ? { startDate: { lte: today }, endDate: { gte: today } } : {},
    include: { brands: true, targets: true },
    orderBy: { campaignId: "desc" },
  });
  if (events.length === 0) return NextResponse.json([]);

  const ids = events.map((e) => e.campaignId);
  const leadCounts = await prisma.lead.groupBy({
    by: ["campaignId", "ownerUserId"],
    where: { campaignId: { in: ids } },
    _count: true,
  });

  const [brands, users] = await Promise.all([
    prisma.brand.findMany(),
    prisma.funUser.findMany(),
  ]);
  const brandName = new Map(brands.map((b) => [b.brandId, b.brandName]));
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));

  return NextResponse.json(events.map((e) => {
    const counts = leadCounts.filter((c) => c.campaignId === e.campaignId);
    const totalLeads = counts.reduce((s, c) => s + c._count, 0);
    return {
      eventId: e.campaignId,
      eventName: e.campaignName,
      startDate: e.startDate, endDate: e.endDate,
      targetLeads: e.targetLeads,
      linePromoMessage: e.linePromoMessage,
      totalLeads,
      brands: e.brands.map((b) => ({ brandId: b.brandId, brandName: brandName.get(b.brandId) ?? "?" })),
      targets: e.targets.map((t) => ({
        userId: t.userId,
        displayName: userName.get(t.userId) ?? "?",
        targetLeads: t.targetLeads,
        actualLeads: counts.find((c) => c.ownerUserId === t.userId)?._count ?? 0,
      })),
    };
  }));
}

// Create event. Body: { eventName, startDate, endDate, targetLeads?,
// brandIds: number[], targets: {userId, targetLeads}[] }
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.eventName === "string" ? b.eventName.trim() : "";
  if (!name || !b.startDate || !b.endDate) {
    return NextResponse.json({ error: "missing eventName/startDate/endDate" }, { status: 400 });
  }
  const eventChannel =
    (await prisma.sourceChannel.findFirst({ where: { channelName: "Event / บูธ" } })) ??
    (await prisma.sourceChannel.create({ data: { channelName: "Event / บูธ", category: "event" } }));

  const ev = await prisma.campaign.create({
    data: {
      campaignName: name,
      channelId: eventChannel.channelId,
      startDate: new Date(String(b.startDate)),
      endDate: new Date(String(b.endDate)),
      targetLeads: typeof b.targetLeads === "number" ? b.targetLeads : null,
      linePromoMessage: typeof b.linePromoMessage === "string" ? b.linePromoMessage.trim() || null : null,
    },
  });
  const brandIds = Array.isArray(b.brandIds) ? (b.brandIds.filter((x) => Number.isInteger(x)) as number[]) : [];
  if (brandIds.length) {
    await prisma.campaignBrand.createMany({ data: brandIds.map((brandId) => ({ campaignId: ev.campaignId, brandId })) });
  }
  const targets = Array.isArray(b.targets) ? (b.targets as { userId?: number; targetLeads?: number }[]) : [];
  const targetRows = targets.filter((t) => Number.isInteger(t.userId)).map((t) => ({
    campaignId: ev.campaignId, userId: t.userId as number, targetLeads: Number(t.targetLeads) || 0,
  }));
  if (targetRows.length) await prisma.campaignTarget.createMany({ data: targetRows });

  return NextResponse.json({ ok: true, eventId: ev.campaignId }, { status: 201 });
}
