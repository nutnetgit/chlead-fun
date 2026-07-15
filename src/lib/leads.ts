import { prisma } from "@/lib/prisma";
import { buildNewLeadFlex } from "@/lib/flex";
import type { ChannelCategory } from "@prisma/client";

// Intake sources accepted from adapters (FB webhook / walk-in form / future).
export type IntakeSource =
  | "facebook" | "messenger" | "line_oa" | "walkin" | "phone" | "referral" | "website";

export type LeadInput = {
  source: IntakeSource;
  // FB path resolves the routing channel by page id; walk-in by brand+branch.
  pageId?: string | null;
  brand?: string | null;
  branchCode?: string | null;
  leadgenId?: string | null;
  customerName?: string | null;
  phone?: string | null;
  modelInterest?: string | null;
  budgetRange?: string | null;
  rawMessage?: string | null;
  consent?: boolean;
};

export type IngestResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      reopen: boolean;
      leadId: number;
      brandId: number;
      lineGroupId: string;
      altText: string;
      flex: Record<string, unknown>;
    };

// Intake source → seeded fun_source_channel row (channel_name from 002 seed).
const SOURCE_CHANNEL: Record<IntakeSource, { name: string; category: ChannelCategory }> = {
  facebook:  { name: "Facebook Lead Ads",      category: "online_paid" },
  messenger: { name: "Facebook Page",          category: "online_owned" },
  line_oa:   { name: "LINE OA",                category: "online_owned" },
  walkin:    { name: "Walk-in โชว์รูม",         category: "walkin" },
  phone:     { name: "โทรเข้า",                 category: "phone" },
  referral:  { name: "ลูกค้าแนะนำ",             category: "referral" },
  website:   { name: "เว็บไซต์บริษัท",           category: "online_owned" },
};

const ACTIVITY_TYPE: Record<IntakeSource, "fb_msg" | "line_msg" | "call_in" | "note"> = {
  facebook: "fb_msg", messenger: "fb_msg", line_oa: "line_msg",
  phone: "call_in", walkin: "note", referral: "note", website: "note",
};

/**
 * Prospect 2.0 intake: resolve routing (fun_channel_config) → dimensions →
 * person (dedup by phone identifier, handoff §A2) → lead (reopen if an active
 * lead already exists for person+brand — repeat inquiry must NOT fail, §4.2) →
 * inbound activity (DB trigger maintains last_activity_at) → LINE Flex card.
 * Does NOT push to LINE — the caller owns the token and pushes what we return.
 */
export async function ingestLead(input: LeadInput): Promise<IngestResult> {
  // 1. Routing: which brand/branch/LINE group does this lead belong to?
  const cfg = input.pageId
    ? await prisma.channelConfig.findFirst({ where: { fbPageId: input.pageId, active: 1 } })
    : input.brand && input.branchCode
      ? await prisma.channelConfig.findFirst({
          where: { brand: input.brand.toLowerCase(), branchCode: input.branchCode, active: 1 },
        })
      : null;
  if (!cfg) return { ok: false, reason: "no_active_channel" };

  // 2. Dimensions (utf8mb4_unicode_ci ⇒ equals is case-insensitive).
  const brand =
    (await prisma.brand.findFirst({ where: { brandName: cfg.brand } })) ??
    (await prisma.brand.create({ data: { brandName: cfg.brand } }));

  const branch =
    (await prisma.branch.findFirst({
      where: { OR: [{ branchCode: cfg.branchCode }, { branchName: cfg.branchCode }] },
    })) ??
    (await prisma.branch.create({ data: { branchName: cfg.branchCode, branchCode: cfg.branchCode } }));
  if (!branch.branchCode) {
    await prisma.branch.update({ where: { branchId: branch.branchId }, data: { branchCode: cfg.branchCode } });
  }

  const chDef = SOURCE_CHANNEL[input.source];
  const channel =
    (await prisma.sourceChannel.findFirst({ where: { channelName: chDef.name } })) ??
    (await prisma.sourceChannel.create({ data: { channelName: chDef.name, category: chDef.category } }));

  // 3. Person — dedup via the (id_type, id_value) unique key on identifiers.
  const phone = input.phone?.trim() || null;
  const name = input.customerName?.trim() || null;

  let personId: bigint | null = null;
  if (phone) {
    const ident = await prisma.personIdentifier.findFirst({
      where: { idType: { in: ["phone", "phone2"] }, idValue: phone },
      include: { person: true },
    });
    if (ident) personId = ident.person.mergedInto ?? ident.personId;
  }
  if (personId === null) {
    const person = await prisma.person.create({ data: { firstName: name } });
    personId = person.personId;
    if (phone) {
      await prisma.personIdentifier
        .create({ data: { personId, idType: "phone", idValue: phone, isPrimary: 1 } })
        .catch(() => {}); // unique race: another request just claimed it — harmless
    }
  }

  // PDPA consent (contact_sales): FB lead forms carry a consent notice (§7).
  const hasConsent = input.source === "facebook" || input.consent;
  if (hasConsent) {
    const existing = await prisma.personConsent.findFirst({
      where: { personId, purpose: "contact_sales", status: "given" },
    });
    if (!existing) {
      await prisma.personConsent.create({
        data: {
          personId, purpose: "contact_sales", channel: "any", status: "given",
          recordedBy: "system", sourceNote: `intake:${input.source}`,
        },
      });
    }
  }

  // 4. Lead — reopen the active one for this person+brand if it exists.
  const now = new Date();
  const existingLead = await prisma.lead.findFirst({
    where: { personId, brandId: brand.brandId, status: { in: ["active", "nurture"] } },
    orderBy: { createdAt: "desc" },
  });

  let leadId: bigint;
  let reopen = false;
  if (existingLead) {
    reopen = true;
    leadId = existingLead.leadId;
    await prisma.lead.update({
      where: { leadId },
      data: {
        status: "active",
        nextActionAt: now,
        fbLeadgenId: input.leadgenId ?? existingLead.fbLeadgenId,
      },
    });
    if (existingLead.status === "nurture") {
      await prisma.leadStageHistory.create({
        data: { leadId, fromStage: existingLead.stage, toStage: existingLead.stage, note: "reopen: กลับมา active จาก nurture" },
      });
    }
  } else {
    const lead = await prisma.lead.create({
      data: {
        personId,
        branchId: branch.branchId,
        brandId: brand.brandId,
        channelId: channel.channelId,
        interestedVariant: input.modelInterest?.trim()?.slice(0, 100) || null,
        stage: "new",
        status: "active",
        fbLeadgenId: input.leadgenId ?? null,
        fbPageId: input.pageId ?? null,
        nextActionAt: now,
      },
    });
    leadId = lead.leadId;
    await prisma.leadStageHistory.create({ data: { leadId, fromStage: null, toStage: "new", note: `intake:${input.source}` } });
  }

  // 5. Inbound activity — the DB trigger updates last_activity_at for us.
  const detailParts = [
    input.budgetRange ? `งบประมาณ: ${input.budgetRange}` : null,
    input.rawMessage || null,
  ].filter(Boolean);
  await prisma.activity.create({
    data: {
      leadId,
      activityType: ACTIVITY_TYPE[input.source],
      direction: "inbound",
      summary: reopen ? `ลูกค้าเดิมทักซ้ำผ่าน ${chDef.name}` : `Lead ใหม่จาก ${chDef.name}`,
      detail: detailParts.join("\n") || null,
    },
  });

  // 6. LINE card for the sales group.
  const { altText, contents } = buildNewLeadFlex({
    brand: cfg.brand, branchCode: cfg.branchCode, source: input.source, reopen,
    customerName: name, phone,
    modelInterest: input.modelInterest, budgetRange: input.budgetRange,
    rawMessage: input.rawMessage,
  });

  return { ok: true, reopen, leadId: Number(leadId), brandId: brand.brandId, lineGroupId: cfg.lineGroupId, altText, flex: contents };
}
