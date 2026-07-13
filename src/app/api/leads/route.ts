import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Lead list for the sales workspace. ?filter=due (default) shows leads whose
 * next_action_at is due today or overdue; ?filter=all shows every active lead;
 * ?filter=archived shows soft-archived leads (any status — see fun_lead.archivedAt,
 * set by the hourly SLA job 30 days after a terminal status goes quiet, or
 * manually) for historical lookup, hidden from the normal working views.
 * ?owner=<userId> narrows to one salesperson — for a `sales` role this is
 * forced to their own funUserId server-side regardless of what the client
 * sends (user req 2026-07-08: previously trusted the query param as-is, so
 * a sales user could view another salesperson's leads just by editing the
 * URL). manager/gm/admin can request any owner or none (see everything).
 */
export async function GET(request: NextRequest) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const p = request.nextUrl.searchParams;
  const filter = p.get("filter") ?? "due";
  const owner = rq.role === "sales" ? String(rq.funUserId) : p.get("owner");

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const leads = await prisma.lead.findMany({
    where: filter === "archived"
      ? { archivedAt: { not: null }, ...(owner ? { ownerUserId: Number(owner) } : {}) }
      : {
          status: "active",
          archivedAt: null,
          ...(owner ? { ownerUserId: Number(owner) } : {}),
          ...(filter === "due" ? { nextActionAt: { lte: endOfToday } } : {}),
        },
    include: {
      person: true, brand: true, branch: true,
      activities: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ temperature: "asc" }, { nextActionAt: "asc" }], // enum order: hot, warm, cold
    take: 200,
  });

  const users = await prisma.funUser.findMany();
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));

  const now = Date.now();
  return NextResponse.json(leads.map((l) => ({
    leadId: Number(l.leadId),
    ownerUserId: l.ownerUserId,
    ownerName: l.ownerUserId ? userName.get(l.ownerUserId) ?? null : null,
    customerName: l.person.nickname || l.person.firstName || "ไม่ระบุชื่อ",
    brand: l.brand.brandName,
    branch: l.branch.branchCode ?? l.branch.branchName,
    modelInterest: l.interestedVariant,
    temperature: l.temperature,
    temperatureConflict: !!l.temperatureConflict,
    aiScore: l.aiScore,
    stage: l.stage,
    daysIdle: Math.floor((now - (l.lastActivityAt ?? l.createdAt ?? new Date()).getTime()) / DAY),
    nextActionAt: l.nextActionAt,
    lastActivity: l.activities[0]?.summary ?? null,
  })));
}

/**
 * Manual lead entry from the workspace ("เพิ่ม Lead" — replaces the old
 * Prospect's add form). Model/color come from the fun_model / fun_vehicle_color
 * master (managed in /settings/models; future: synced read-only from SPS).
 * Dedup matches the FB-intake path: phone identifier → existing person →
 * an active lead for person+brand is REOPENED, not duplicated.
 * Body: { customerName, phone?, brandId, branchId, channelId, modelId?,
 *         colorName?, budgetNote?, note?, ownerUserId?, consent? }
 *
 * channelId (user-reported 2026-07-13) points at a real fun_source_channel
 * row — the form used to send a fixed 5-way "source" string mapped to
 * hardcoded channel names, completely disconnected from the channels an
 * admin actually manages in /settings/sources (and any new/renamed channel
 * there was invisible to this form). The dropdown now lists real channels.
 */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const customerName = typeof b.customerName === "string" ? b.customerName.trim() : "";
  const brandId = Number(b.brandId);
  const branchId = Number(b.branchId);
  const channelId = Number(b.channelId);
  if (!customerName || !Number.isInteger(brandId) || !Number.isInteger(branchId) || !Number.isInteger(channelId)) {
    return NextResponse.json({ error: "missing customerName/brandId/branchId/channelId" }, { status: 400 });
  }

  const channel = await prisma.sourceChannel.findUnique({ where: { channelId } });
  if (!channel) return NextResponse.json({ error: "ช่องทางไม่ถูกต้อง" }, { status: 400 });

  const model = b.modelId ? await prisma.vehicleModel.findUnique({ where: { modelId: Number(b.modelId) } }) : null;
  const phone = typeof b.phone === "string" ? b.phone.replace(/[^0-9+]/g, "").replace(/^\+66/, "0") || null : null;

  // person dedup by phone
  let personId: bigint | null = null;
  if (phone) {
    const ident = await prisma.personIdentifier.findFirst({
      where: { idType: { in: ["phone", "phone2"] }, idValue: phone },
      include: { person: true },
    });
    if (ident) personId = ident.person.mergedInto ?? ident.personId;
  }
  if (personId === null) {
    const person = await prisma.person.create({ data: { firstName: customerName } });
    personId = person.personId;
    if (phone) {
      await prisma.personIdentifier.create({ data: { personId, idType: "phone", idValue: phone, isPrimary: 1 } }).catch(() => {});
    }
  }
  if (b.consent) {
    const has = await prisma.personConsent.findFirst({ where: { personId, purpose: "contact_sales", status: "given" } });
    if (!has) {
      await prisma.personConsent.create({
        data: { personId, purpose: "contact_sales", channel: "any", status: "given", recordedBy: "web", sourceNote: `manual:${channel.channelName}` },
      });
    }
  }

  const now = new Date();
  const existing = await prisma.lead.findFirst({
    where: { personId, brandId, status: { in: ["active", "nurture"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await prisma.lead.update({ where: { leadId: existing.leadId }, data: { status: "active", nextActionAt: now } });
    await prisma.activity.create({
      data: {
        leadId: existing.leadId, activityType: "note", direction: "inbound",
        summary: `ลูกค้าติดต่อซ้ำผ่าน ${channel.channelName}`,
        detail: typeof b.note === "string" ? b.note : null,
        createdBy: typeof b.ownerUserId === "number" ? b.ownerUserId : null,
      },
    });
    return NextResponse.json({ ok: true, reopen: true, leadId: Number(existing.leadId) });
  }

  const lead = await prisma.lead.create({
    data: {
      personId, branchId, brandId, channelId: channel.channelId,
      interestedModelId: model?.modelId ?? null,
      interestedVariant: model?.modelName ?? null,
      interestedColor: typeof b.colorName === "string" ? b.colorName.trim() || null : null,
      ownerUserId: typeof b.ownerUserId === "number" ? b.ownerUserId : null,
      stage: "new", status: "active", nextActionAt: now,
    },
  });
  await prisma.leadStageHistory.create({ data: { leadId: lead.leadId, fromStage: null, toStage: "new", note: `manual:${channel.channelName}` } });
  const detailParts = [
    typeof b.budgetNote === "string" && b.budgetNote.trim() ? `งบประมาณ: ${b.budgetNote.trim()}` : null,
    typeof b.note === "string" && b.note.trim() ? b.note.trim() : null,
  ].filter(Boolean);
  await prisma.activity.create({
    data: {
      leadId: lead.leadId, activityType: "note", direction: "inbound",
      summary: `Lead ใหม่จาก ${channel.channelName}`,
      detail: detailParts.join("\n") || null,
      createdBy: typeof b.ownerUserId === "number" ? b.ownerUserId : null,
    },
  });
  return NextResponse.json({ ok: true, reopen: false, leadId: Number(lead.leadId) }, { status: 201 });
}
