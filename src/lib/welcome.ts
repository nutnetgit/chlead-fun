import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { linePush } from "@/lib/flex";
import { getLineCredsForBrand } from "@/lib/lineConfig";
import { isLineWelcomeActive } from "@/lib/settings";

/**
 * Welcome greeting delivery (user req 2026-07-14 — "Reply Token" quota play).
 *
 * Every QR registration used to end in a PUSH greeting = 1 paid message per
 * scan. LINE's Reply API is free, but a reply token only exists on an
 * INBOUND event — so the LIFF form now sends a short registration message
 * *as the customer* (liff.sendMessages) right after a successful submit.
 * That message hits our webhook carrying a reply token, and the webhook
 * answers with this same greeting via lineReply() — zero quota, for both
 * brand-new and repeat customers.
 *
 * The marker prefix is how the webhook recognizes that inbound message.
 * It's a real visible message in the customer's own chat (transparent, they
 * see exactly what was sent on their behalf), so it's phrased naturally.
 *
 * Push remains the fallback path: LIFF opened outside the LINE app, the
 * customer not (yet) a friend of the OA so sendMessages throws, or the
 * reply call itself failing — those still go through deliverWelcomeByPush.
 */
export const WELCOME_MARKER_PREFIX = "ลงทะเบียนสนใจรถ";

type WelcomePayload = {
  lineUserId: string;
  messages: Record<string, unknown>[];
  texts: string[]; // same content as messages, for chat-history logging
  brandId: number;
};

// Fresh-queried builder (no request-scoped state) so the webhook and the
// fallback endpoint produce byte-identical greetings to the original inline
// push. Returns null when the lead can't be greeted (no LINE link, gate off).
export async function buildWelcomeMessages(leadId: bigint): Promise<WelcomePayload | null> {
  const gate = await isLineWelcomeActive();
  if (!gate.active) return null;

  const lead = await prisma.lead.findUnique({
    where: { leadId },
    include: { person: true, brand: true, branch: true },
  });
  if (!lead) return null;

  // A pending owner-switch consent means the customer just got (or is about
  // to get) the consent Flex instead of a greeting — never race it with a
  // welcome message naming the WRONG (still-current) salesperson.
  const pendingSwitch = await prisma.ownerSwitchRequest.findFirst({
    where: { leadId, status: "pending" },
  });
  if (pendingSwitch) return null;

  const [owner, ident, event] = await Promise.all([
    lead.ownerUserId ? prisma.funUser.findUnique({ where: { userId: lead.ownerUserId } }) : Promise.resolve(null),
    prisma.personIdentifier.findFirst({ where: { personId: lead.personId, idType: "line_userid" } }),
    lead.campaignId ? prisma.campaign.findUnique({ where: { campaignId: lead.campaignId } }) : Promise.resolve(null),
  ]);
  if (!owner || !ident) return null;

  const salesName = owner.nickname || owner.displayName;
  const phoneLine = owner.phone ? `\nเบอร์ติดต่อ ${owner.phone}` : "";
  const greetingText = `${lead.brand.brandName} ช.เอราวัณ ยินดีให้บริการ\nที่ปรึกษาการขายของท่านคือ\nคุณ ${salesName} จาก โชว์รูม ${lead.branch.branchName}${phoneLine}`;

  const texts = [greetingText];
  if (event?.linePromoMessage) texts.push(event.linePromoMessage);
  return {
    lineUserId: ident.idValue,
    messages: texts.map((text) => ({ type: "text", text })),
    texts,
    brandId: lead.brandId,
  };
}

export async function logWelcomeToChat(leadId: bigint, w: WelcomePayload): Promise<void> {
  for (const body of w.texts) {
    await prisma.chatMessage.create({
      data: { leadId, direction: "outbound", lineUserId: w.lineUserId, body },
    }).catch((e) => console.error("[welcome] chat log failed:", e));
  }
}

// The paid path (1 push message) — original behavior, now the fallback.
export async function deliverWelcomeByPush(leadId: bigint): Promise<boolean> {
  const w = await buildWelcomeMessages(leadId);
  if (!w) return false;
  const creds = await getLineCredsForBrand(w.brandId);
  if (!creds.accessToken) return false;
  const push = await linePush(creds.accessToken, w.lineUserId, w.messages);
  if (!push.ok) {
    console.error(`[welcome push] lead=${leadId} status=${push.status} detail=${push.detail ?? ""}`);
    return false;
  }
  await logWelcomeToChat(leadId, w);
  return true;
}

// HMAC guard for the public push-fallback endpoint — the register response
// hands this to the LIFF page; without it anyone could spam pushes at a
// leadId. Keyed off AUTH_SECRET (always set in prod).
export function welcomeSig(leadId: bigint): string {
  const secret = process.env.AUTH_SECRET || process.env.WEBHOOK_SECRET || "dev";
  return crypto.createHmac("sha256", secret).update(`welcome:${leadId}`).digest("hex");
}

export function verifyWelcomeSig(leadId: bigint, sig: string): boolean {
  try {
    const a = Buffer.from(welcomeSig(leadId));
    const b = Buffer.from(sig);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
