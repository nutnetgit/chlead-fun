import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { linePush, linePushFlex, buildOwnerConsentBubble } from "@/lib/flex";
import { isLineWelcomeActive, getOwnerSwitchConfig } from "@/lib/settings";
import { getLineCredsForBrand } from "@/lib/lineConfig";

/**
 * Customer self-intake from a salesperson's QR (user req 2026-07-07, reworked
 * 2026-07-08 to be LIFF-first — add-friend-first order: customer adds the
 * LINE OA as a friend FIRST via LIFF, THEN fills this same form, in one pass.
 * This replaces the old two-step flow (form → separate /liff/welcome add-
 * friend step) which let a customer submit and simply never tap the
 * follow-up button, leaving the lead with no LINE link. Since linking now
 * happens in the same request as lead creation, the old HMAC tamper-guard
 * token (src/lib/liffToken.ts, retired) is no longer needed — there's no
 * separate "link this line_userid to an existing lead" step to protect.
 *
 * The QR link already encodes who the lead belongs to (owner), where
 * (branch/brand) and the source context (walk-in vs a specific event).
 * Submitting the form = PDPA consent (the form displays the consent notice).
 *
 * Public endpoint (no secret — customers hit it from their phones, either via
 * /liff/register with a verified lineUserId, or /lead-form as a no-LINE
 * fallback without one). Validates every referenced id server-side so
 * tampered links can't inject bogus ownership. Dedup matches every other
 * intake path.
 * Body: { name, phone, lineId?, lineUserId?, modelId?, ownerUserId, brandId, branchId, eventId? }
 */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof b.name === "string" ? b.name.trim() : "";
  // Verified LINE profile displayName (user req 2026-07-13) — the `name`
  // field above is a customer-editable text box on the form and can end up
  // "corrected"/retyped to something else; when this is present it's always
  // the one stored/shown in /chat and lead cards, never the typed value.
  const lineDisplayName = typeof b.lineDisplayName === "string" ? b.lineDisplayName.trim().slice(0, 100) : "";
  const storedName = lineDisplayName || name;
  const rawPhone = typeof b.phone === "string" ? b.phone : "";
  const phone = rawPhone.replace(/[^0-9+]/g, "").replace(/^\+66/, "0");
  // Customer-typed LINE ID (the shareable @id, NOT the internal push userId).
  const lineId = typeof b.lineId === "string" ? b.lineId.trim().replace(/^@/, "").slice(0, 100) : "";
  // Verified LINE userId from liff.getProfile() (see /liff/register) — distinct
  // from the self-typed lineId above; this is the one push messages can target.
  const lineUserId = typeof b.lineUserId === "string" ? b.lineUserId.trim() : "";
  // LINE profile picture (user req 2026-07-11) — shown in /chat instead of
  // the generated color-avatar. Only ever set from a verified LIFF profile
  // fetch, never customer-typed, so no extra validation needed beyond type.
  const pictureUrl = typeof b.pictureUrl === "string" ? b.pictureUrl.trim().slice(0, 500) : "";
  const ownerUserId = Number(b.ownerUserId);
  const brandId = Number(b.brandId);
  const branchId = Number(b.branchId);
  const eventId = b.eventId ? Number(b.eventId) : null;
  const VALID_TIMEFRAMES = new Set(["within_1m", "m1_3", "m3_6", "over_6m"]);
  const buyTimeframe = typeof b.buyTimeframe === "string" && VALID_TIMEFRAMES.has(b.buyTimeframe) ? b.buyTimeframe : undefined;
  // Auto-classify temperature from the customer's own stated urgency (user
  // req 2026-07-13) — "just looking" always lands COLD; anything with a
  // real timeframe is at least WARM, with "this month" bumped to HOT. Staff
  // can still override manually afterward same as any AI-set temperature.
  const TIMEFRAME_TEMP: Record<string, "hot" | "warm" | "cold"> = {
    within_1m: "hot", m1_3: "warm", m3_6: "cold", over_6m: "cold",
  };
  const autoTemperature = buyTimeframe ? TIMEFRAME_TEMP[buyTimeframe] : undefined;

  if (!name || !phone || phone.length < 9) return NextResponse.json({ error: "กรุณากรอกชื่อและเบอร์โทรให้ถูกต้อง" }, { status: 400 });
  if (!Number.isInteger(ownerUserId) || !Number.isInteger(brandId) || !Number.isInteger(branchId)) {
    return NextResponse.json({ error: "ลิงก์ไม่สมบูรณ์" }, { status: 400 });
  }

  // Validate the encoded context really exists (tamper guard).
  const [owner, brand, branch, event] = await Promise.all([
    prisma.funUser.findFirst({ where: { userId: ownerUserId, isActive: 1 } }),
    prisma.brand.findUnique({ where: { brandId } }),
    prisma.branch.findUnique({ where: { branchId } }),
    eventId ? prisma.campaign.findUnique({ where: { campaignId: eventId } }) : Promise.resolve(null),
  ]);
  if (!owner || !brand || !branch || (eventId && !event)) {
    return NextResponse.json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุ" }, { status: 400 });
  }
  // Re-bound as definitely-non-null: `brand`/`branch` are read inside
  // sendWelcomePush, a nested closure declared further down — TS won't
  // carry the guard's narrowing through a closure over a `const` from
  // array destructuring.
  const brandRow = brand;
  const branchRow = branch;

  const channelName = eventId ? "Event / บูธ" : "Walk-in โชว์รูม";
  const channel =
    (await prisma.sourceChannel.findFirst({ where: { channelName } })) ??
    (await prisma.sourceChannel.create({ data: { channelName, category: eventId ? "event" : "walkin" } }));

  const model = b.modelId ? await prisma.vehicleModel.findUnique({ where: { modelId: Number(b.modelId) } }) : null;

  // person dedup by phone identifier
  let personId: bigint | null = null;
  const ident = await prisma.personIdentifier.findFirst({
    where: { idType: { in: ["phone", "phone2"] }, idValue: phone },
    include: { person: true },
  });
  if (ident) personId = ident.person.mergedInto ?? ident.personId;
  if (personId === null) {
    const person = await prisma.person.create({ data: { firstName: storedName, pictureUrl: pictureUrl || null } });
    personId = person.personId;
    await prisma.personIdentifier.create({ data: { personId, idType: "phone", idValue: phone, isPrimary: 1 } }).catch(() => {});
  } else if (pictureUrl || lineDisplayName) {
    // Existing person re-registering (or a second brand's QR) — refresh to
    // their current LINE picture/name rather than leaving a stale one.
    await prisma.person.update({
      where: { personId },
      data: { ...(pictureUrl ? { pictureUrl } : {}), ...(lineDisplayName ? { firstName: lineDisplayName } : {}) },
    }).catch(() => {});
  }
  if (lineId) {
    await prisma.personIdentifier.create({ data: { personId, idType: "line_id", idValue: lineId } }).catch(() => {}); // unique dup → ignore
  }
  if (lineUserId) {
    await prisma.personIdentifier.upsert({
      where: { idType_idValue: { idType: "line_userid", idValue: lineUserId } },
      update: { personId },
      create: { personId, idType: "line_userid", idValue: lineUserId },
    });
  }
  const hasConsent = await prisma.personConsent.findFirst({ where: { personId, purpose: "contact_sales", status: "given" } });
  if (!hasConsent) {
    await prisma.personConsent.create({
      data: { personId, purpose: "contact_sales", channel: "any", status: "given", recordedBy: "qr-form", sourceNote: eventId ? `qr:event:${eventId}` : "qr:walkin" },
    });
  }

  const salesName = owner.nickname || owner.displayName;
  const salesPhone = owner.phone ?? null;
  const showroomLabel = `${brand.brandName} ${branch.branchName}`.trim();

  // Welcome push (quota-gated — user req 2026-07-08, see src/lib/settings.ts
  // isLineWelcomeActive). Fires in the same request as lead creation now that
  // linking happens up front, rather than a separate follow-up call.
  // Template per user req 2026-07-12 — brand name leads the greeting line,
  // branch name (not brand+branch combined) on the showroom line.
  async function sendWelcomePush(leadId: bigint): Promise<boolean> {
    if (!lineUserId) return false;
    const creds = await getLineCredsForBrand(brandId);
    const gate = await isLineWelcomeActive();
    if (!creds.accessToken || !gate.active) return false;
    const messages: Record<string, unknown>[] = [];
    const phoneLine = salesPhone ? `\nเบอร์ติดต่อ ${salesPhone}` : "";
    const greetingText = `${brandRow.brandName} ช.เอราวัณ ยินดีให้บริการ\nที่ปรึกษาการขายของท่านคือ\nคุณ ${salesName} จาก โชว์รูม ${branchRow.branchName}${phoneLine}`;
    messages.push({ type: "text", text: greetingText });
    if (event?.linePromoMessage) messages.push({ type: "text", text: event.linePromoMessage });
    const push = await linePush(creds.accessToken, lineUserId, messages);
    if (!push.ok) {
      console.error(`[welcome push] brand=${brandId} lead=${leadId} status=${push.status} detail=${push.detail ?? ""}`);
      return false;
    }
    // Log to our own chat history (user req 2026-07-13) — otherwise a
    // brand-new lead with only a greeting and no reply yet never appears in
    // /chat at all (its list only shows leads with >=1 fun_chat_message row).
    await prisma.chatMessage.create({
      data: { leadId, direction: "outbound", lineUserId, body: greetingText },
    }).catch((e) => console.error("[welcome push] chat log failed:", e));
    if (event?.linePromoMessage) {
      await prisma.chatMessage.create({
        data: { leadId, direction: "outbound", lineUserId, body: event.linePromoMessage },
      }).catch((e) => console.error("[welcome push] promo chat log failed:", e));
    }
    return true;
  }

  const now = new Date();
  const existing = await prisma.lead.findFirst({
    where: { personId, brandId, status: { in: ["active", "nurture"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    await prisma.lead.update({
      where: { leadId: existing.leadId },
      data: {
        status: "active", nextActionAt: now,
        ...(buyTimeframe ? { buyTimeframe: buyTimeframe as never } : {}),
        ...(autoTemperature ? { temperature: autoTemperature, temperatureConflict: 0 } : {}),
      },
    });
    await prisma.activity.create({
      data: {
        leadId: existing.leadId, activityType: "note", direction: "inbound",
        summary: `ลูกค้ากรอก QR ซ้ำ (${eventId ? event!.campaignName : "Walk-in"})`,
      },
    });

    // Customer-consent ownership switch (user req 2026-07-10, made toggleable
    // 2026-07-12): a different salesperson's QR was scanned for the SAME
    // brand this person already has an active/nurture lead + owner for.
    if (existing.ownerUserId && existing.ownerUserId !== ownerUserId && lineUserId) {
      const currentOwner = await prisma.funUser.findUnique({ where: { userId: existing.ownerUserId } });
      const currentOwnerInactive = !currentOwner || currentOwner.isActive !== 1;
      const ownerSwitchCfg = await getOwnerSwitchConfig();

      // Safety net regardless of the toggle: an owner who's left/been
      // disabled can't "keep" the lead forever — that strands the customer
      // with nobody watching it. Reassign to whoever scanned, silently.
      if (currentOwnerInactive) {
        await prisma.$transaction([
          prisma.lead.update({ where: { leadId: existing.leadId }, data: { ownerUserId } }),
          prisma.assignmentHistory.create({
            data: { leadId: existing.leadId, fromUserId: existing.ownerUserId, toUserId: ownerUserId, reason: "owner_inactive_reassign", assignedBy: null },
          }),
        ]);
        const pushed = await sendWelcomePush(existing.leadId);
        return NextResponse.json({ ok: true, reopen: true, leadId: String(existing.leadId), pushed, salesName, salesPhone, showroomLabel });
      }

      if (!ownerSwitchCfg.enabled) {
        // Toggled off: no question asked, current (active) owner stays —
        // just the normal welcome push, same as any repeat scan.
        const pushed = await sendWelcomePush(existing.leadId);
        const currentOwnerName = currentOwner!.nickname || currentOwner!.displayName;
        return NextResponse.json({ ok: true, reopen: true, leadId: String(existing.leadId), pushed, salesName: currentOwnerName, salesPhone: currentOwner!.phone ?? null, showroomLabel });
      }

      // Toggled on (default): never reassign silently — the owner stays
      // as-is (already true above, ownerUserId untouched) and the CUSTOMER
      // decides via a Flex message with 2 buttons. Replaces the generic
      // welcome push for this case (it already conveys "you have an
      // existing salesperson").
      const creds = await getLineCredsForBrand(existing.brandId);
      const currentOwnerName = currentOwner!.nickname || currentOwner!.displayName;
      const req = await prisma.ownerSwitchRequest.create({
        data: { leadId: existing.leadId, currentOwnerId: existing.ownerUserId, offeredOwnerId: ownerUserId },
      });
      let pushed = false;
      if (creds.accessToken) {
        const { altText, contents } = buildOwnerConsentBubble({ requestId: req.requestId, currentOwnerName, offeredOwnerName: salesName });
        const push = await linePushFlex(creds.accessToken, lineUserId, altText, contents);
        pushed = push.ok;
      }
      return NextResponse.json({ ok: true, reopen: true, leadId: String(existing.leadId), pushed, salesName: currentOwnerName, salesPhone: currentOwner!.phone ?? null, showroomLabel, ownerSwitchPending: true });
    }

    const pushed = await sendWelcomePush(existing.leadId);
    return NextResponse.json({ ok: true, reopen: true, leadId: String(existing.leadId), pushed, salesName, salesPhone, showroomLabel });
  }

  const lead = await prisma.lead.create({
    data: {
      personId, branchId, brandId,
      channelId: channel.channelId,
      campaignId: eventId,
      interestedModelId: model?.modelId ?? null,
      interestedVariant: model?.modelName ?? null,
      buyTimeframe: buyTimeframe as never,
      temperature: autoTemperature,
      ownerUserId,
      stage: "new", status: "active", nextActionAt: now,
    },
  });
  await prisma.leadStageHistory.create({
    data: { leadId: lead.leadId, fromStage: null, toStage: "new", note: eventId ? `qr:event:${event!.campaignName}` : "qr:walkin" },
  });
  await prisma.activity.create({
    data: {
      leadId: lead.leadId, activityType: "note", direction: "inbound",
      summary: eventId ? `Lead ใหม่จาก QR — Event: ${event!.campaignName}` : "Lead ใหม่จาก QR — Walk-in โชว์รูม",
      detail: model ? `รุ่นที่สนใจ: ${model.modelName}` : null,
    },
  });
  const pushed = await sendWelcomePush(lead.leadId);
  return NextResponse.json({ ok: true, reopen: false, leadId: String(lead.leadId), pushed, salesName, salesPhone, showroomLabel }, { status: 201 });
}
