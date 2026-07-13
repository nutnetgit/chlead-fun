import { NextRequest, NextResponse } from "next/server";
import { setSetting } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { verifyLineSignature, lineReply } from "@/lib/lineAuth";
import { handleSlaPostback, type PostbackAction } from "@/lib/governance";
import { resolveLineCreds } from "@/lib/lineConfig";

const OWNER_SWITCH_ACTIONS = new Set(["keep_owner", "switch_owner"]);

export const runtime = "nodejs";

/**
 * LINE Messaging API webhook — three jobs:
 *   1. Group-ID capture (unchanged, non-secret — see below)
 *   2. Postback handling for the SLA-escalate card's 3 buttons (handoff §5)
 *      — this DOES mutate lead data, so X-Line-Signature is verified before
 *      any postback is acted on (handoff §7 requirement, unlike group-id
 *      capture). Needs LINE_CHANNEL_SECRET in env (Basic settings — a
 *      DIFFERENT credential from the push token). Only fun_user rows with
 *      role manager/gm may trigger governance actions.
 *   3. Inbound customer chat messages (user req 2026-07-08, in-house LINE
 *      chat) — resolves the sender's line_userid to a lead via
 *      PersonIdentifier, logs to fun_chat_message. Deliberately NOT logged as
 *      an Activity — see prisma/schema.prisma ChatMessage comment. Kept even
 *      when unresolved (leadId null) for manual triage in /chat.
 *
 * Per-brand LINE OA (user req 2026-07-11): one webhook URL still serves
 * every brand's channel. LINE's console doesn't expose a copyable "Bot user
 * ID" anywhere, so brand identity is auto-detected instead of manually
 * configured: `destination` (present on every request body) is matched
 * against whatever's already been learned, falling back to testing the
 * signature against every configured brand's secret on a cold start (see
 * resolveLineCreds in src/lib/lineConfig.ts). Falls back to the legacy
 * single-OA env vars for brands not yet migrated, so rollout can happen
 * brand-by-brand.
 *
 * The app is now publicly reachable at fun.ch-erawan.com (Cloudflare Public
 * Hostname), so this endpoint can be the OA's real webhook URL going
 * forward — the n8n "[FUN] LINE Group-ID Capture" workflow was only a
 * stand-in for when the app was LAN-only.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: { events?: Array<Record<string, unknown>>; destination?: string } = {};
  try { body = JSON.parse(raw); } catch { /* LINE "Verify" sends an empty body */ }

  const events = body.events ?? [];
  const creds = await resolveLineCreds(raw, request.headers.get("x-line-signature"), body.destination);

  // ── 1. Group-ID capture (message events, non-secret) ───────────────────
  const src = events.find((e) => {
    const s = e.source as { groupId?: string; roomId?: string } | undefined;
    return s?.groupId || s?.roomId;
  })?.source as { groupId?: string; roomId?: string } | undefined;
  if (src?.groupId || src?.roomId) {
    await setSetting("line_last_group_id", { id: src.groupId || src.roomId, at: new Date().toISOString() }).catch(() => {});
  }

  // ── 2. Postback events (mutates data — signature verified) ──────────────
  const postbacks = events.filter((e) => e.type === "postback");
  if (postbacks.length) {
    const channelSecret = creds.secret;
    const sigOk = verifyLineSignature(raw, request.headers.get("x-line-signature"), channelSecret);
    if (!channelSecret) {
      console.warn("[line webhook] no channel secret resolved (destination unmatched and LINE_CHANNEL_SECRET not set) — postbacks are NOT verified.");
    }
    if (channelSecret && !sigOk) {
      return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
    }

    const replyToken = creds.accessToken;
    for (const ev of postbacks) {
      try {
        const data = new URLSearchParams(String((ev.postback as { data?: string })?.data ?? ""));
        const action = data.get("action");
        const tapperLineUserId = (ev.source as { userId?: string })?.userId;
        const evReplyToken = (ev as { replyToken?: string }).replyToken;
        if (!action || !tapperLineUserId) continue;

        // ── Customer-consent ownership switch (user req 2026-07-10) ──────
        // Distinct from the governance postbacks below: the CUSTOMER taps
        // this, not staff, so no manager/gm role check — just confirms the
        // tapper is the same LINE account the request was sent to.
        if (OWNER_SWITCH_ACTIONS.has(action)) {
          const reqId = Number(data.get("req"));
          if (!Number.isInteger(reqId)) continue;
          const switchReq = await prisma.ownerSwitchRequest.findUnique({ where: { requestId: reqId } });
          if (!switchReq || switchReq.status !== "pending") continue;

          const lead = await prisma.lead.findUnique({ where: { leadId: switchReq.leadId } });
          const ident = lead ? await prisma.personIdentifier.findFirst({ where: { personId: lead.personId, idType: "line_userid" } }) : null;
          if (!ident || ident.idValue !== tapperLineUserId) continue; // not the customer this request was for

          if (action === "switch_owner") {
            await prisma.$transaction([
              prisma.lead.update({ where: { leadId: switchReq.leadId }, data: { ownerUserId: switchReq.offeredOwnerId } }),
              prisma.assignmentHistory.create({
                data: { leadId: switchReq.leadId, fromUserId: switchReq.currentOwnerId, toUserId: switchReq.offeredOwnerId, reason: "customer_consent", assignedBy: null },
              }),
              prisma.ownerSwitchRequest.update({ where: { requestId: reqId }, data: { status: "switched", resolvedAt: new Date() } }),
            ]);
          } else {
            await prisma.ownerSwitchRequest.update({ where: { requestId: reqId }, data: { status: "kept", resolvedAt: new Date() } });
          }
          if (evReplyToken && replyToken) {
            const text = action === "switch_owner" ? "เปลี่ยนผู้ดูแลเรียบร้อยค่ะ 🙏" : "รับทราบค่ะ ยินดีให้บริการต่อนะคะ 🙏";
            await lineReply(replyToken, evReplyToken, [{ type: "text", text }]);
          }
          continue;
        }

        const leadIdStr = data.get("lead");
        if (!leadIdStr) continue;
        const actor = await prisma.funUser.findFirst({ where: { lineUserid: tapperLineUserId } });
        if (!actor || (actor.role !== "manager" && actor.role !== "gm")) {
          if (evReplyToken && replyToken) {
            await lineReply(replyToken, evReplyToken, [{ type: "text", text: "การดำเนินการนี้สำหรับผู้จัดการเท่านั้น" }]);
          }
          continue;
        }

        const result = await handleSlaPostback(action as PostbackAction, BigInt(leadIdStr), actor.userId);
        if (evReplyToken && replyToken) {
          await lineReply(replyToken, evReplyToken, [{ type: "text", text: result.replyText }]);
        }
        if (result.pushToOwner && replyToken) {
          await fetch("https://api.line.me/v2/bot/message/push", {
            method: "POST",
            headers: { Authorization: `Bearer ${replyToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ to: result.pushToOwner.lineUserid, messages: [{ type: "text", text: result.pushToOwner.text }] }),
          });
        }
      } catch (e) {
        console.error("[line webhook] postback error:", e);
      }
    }
  }

  // ── 3. Inbound chat messages (signature verified, same as postbacks) ────
  const messages = events.filter((e) => e.type === "message" && (e.message as { type?: string } | undefined)?.type === "text");
  if (messages.length) {
    const channelSecret = creds.secret;
    const sigOk = verifyLineSignature(raw, request.headers.get("x-line-signature"), channelSecret);
    if (channelSecret && !sigOk) {
      return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
    }
    for (const ev of messages) {
      try {
        const sourceUserId = (ev.source as { userId?: string })?.userId;
        const msg = ev.message as { id?: string; text?: string };
        if (!sourceUserId || !msg?.text) continue;

        // A LINE account is ONE physical conversation, but a customer can
        // legitimately have several active leads at once (different brands/
        // salespeople, e.g. scanned two salespeople's QRs) — user-found bug
        // 2026-07-10: resolving to only the single most-recent lead meant
        // the OTHER salesperson never saw the customer's replies at all.
        // Fan the inbound message out to every active lead so both sides see
        // it in their own /chat thread; falls back to the unresolved bucket
        // (leadId null) if we can't resolve any lead.
        //
        // Per-brand LINE OA (user req 2026-07-11): this line_userid is
        // scoped to the OA that received it (LINE issues a different userId
        // per channel for the same physical customer), so it can only ever
        // match leads that belong to that SAME brand anyway — the customer
        // never friended any other brand's OA under this id. When the
        // brand is known (creds.brandId), scope explicitly so a stray
        // legacy-fallback destination can't cross-contaminate; unresolved
        // destinations (legacy/not-yet-migrated brand) keep the old
        // all-active-leads behavior.
        const ident = await prisma.personIdentifier.findUnique({
          where: { idType_idValue: { idType: "line_userid", idValue: sourceUserId } },
          include: {
            person: {
              include: { leads: { where: { status: "active", ...(creds.brandId !== null ? { brandId: creds.brandId } : {}) } } },
            },
          },
        });
        const activeLeadIds = ident?.person.leads.map((l) => l.leadId) ?? [];

        // Staff testing/replying to the OA directly with their own LINE
        // account isn't a customer inquiry (user-reported 2026-07-12: the
        // webhook was pulling these into /chat's "unresolved" bucket,
        // cluttering it with internal noise) — but ONLY skip when it truly
        // has no lead to attach to. Checked AFTER lead resolution (fixed
        // 2026-07-13): a staff member testing their own QR flow with their
        // own LINE account resolves to a real active lead, and that reply
        // must still show up — the earlier staff-check ran first and
        // silently dropped it even though a lead existed.
        if (activeLeadIds.length === 0) {
          const isStaff = await prisma.funUser.findFirst({ where: { lineUserid: sourceUserId } });
          if (isStaff) continue;
        }

        const targets: (bigint | null)[] = activeLeadIds.length ? activeLeadIds : [null];

        for (const leadId of targets) {
          // Retry-safety per (leadId, lineMessageId) — an explicit check
          // instead of a DB unique constraint, since the same lineMessageId
          // now legitimately appears once per active lead (see sql/017).
          const dup = msg.id ? await prisma.chatMessage.findFirst({ where: { leadId, lineMessageId: msg.id } }) : null;
          if (dup) continue;
          await prisma.chatMessage.create({
            data: {
              leadId, direction: "inbound", lineUserId: sourceUserId,
              lineMessageId: msg.id ?? null, body: msg.text.slice(0, 4000),
            },
          });
        }
      } catch (e) {
        console.error("[line webhook] message error:", e);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
