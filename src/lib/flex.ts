import { BRAND_LABELS, type BrandKey } from "@/lib/types";
import { trackLineSend } from "@/lib/settings";

// Push a LINE Flex message to a group/user via the Messaging API. Token is
// passed in (comes from env in the Meta webhook handler). Best-effort; returns
// a status so the caller can log failures without throwing. Counts against
// the monthly LINE quota tracker on success (user req 2026-07-08 — see
// src/lib/settings.ts trackLineSend/getLineQuotaConfig).
export async function linePushFlex(
  token: string,
  to: string,
  altText: string,
  contents: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages: [{ type: "flex", altText, contents }] }),
    });
    let detail: string | undefined;
    if (!res.ok) { try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ } }
    if (res.ok) trackLineSend(1).catch(() => {});
    return { ok: res.ok, status: res.status, detail };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e).slice(0, 160) };
  }
}

// Human labels for the lead source shown on the card.
const SOURCE_LABEL: Record<string, string> = {
  facebook: "Facebook Lead Ad",
  messenger: "Messenger",
  line_oa: "LINE OA",
  walkin: "Walk-in form",
  phone: "โทรศัพท์",
  referral: "แนะนำ",
  website: "เว็บไซต์",
};

// Generic push of an arbitrary LINE messages array (text + flex mixed).
// LINE counts 1 quota unit per message bubble sent, so a batch of N messages
// in one push call tracks as N (user req 2026-07-08 — see trackLineSend).
export async function linePush(
  token: string,
  to: string,
  messages: Record<string, unknown>[],
): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to, messages }),
    });
    let detail: string | undefined;
    if (!res.ok) { try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ } }
    if (res.ok) trackLineSend(messages.length).catch(() => {});
    return { ok: res.ok, status: res.status, detail };
  } catch (e) {
    return { ok: false, status: 0, detail: String(e).slice(0, 160) };
  }
}

// A morning-nudge bubble: lead identity + the AI draft + status buttons whose
// postbacks WF4 will handle. The draft itself is sent as a separate plain-text
// message (easy to long-press copy) — this card carries the action buttons.
export function buildNudgeBubble(opts: {
  leadId: number;
  brand: string;
  branchCode: string;
  customerName?: string | null;
  modelInterest?: string | null;
  score?: string | null;
}): { altText: string; contents: Record<string, unknown> } {
  const brandLabel = BRAND_LABELS[opts.brand as BrandKey] ?? opts.brand;
  const SCORE_COLOR: Record<string, string> = { hot: "#E23744", warm: "#E8A33D", cold: "#6B8CB8" };
  const btn = (label: string, action: string, style: string) => ({
    type: "button", style, height: "sm",
    action: { type: "postback", label, data: `action=${action}&lead=${opts.leadId}`, displayText: label },
  });
  const contents = {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        {
          type: "box", layout: "baseline", spacing: "sm",
          contents: [
            { type: "text", text: `👤 ${opts.customerName || "ไม่ระบุชื่อ"}`, weight: "bold", size: "sm", flex: 5, wrap: true },
            ...(opts.score ? [{ type: "text", text: opts.score.toUpperCase(), size: "xs", align: "end", color: SCORE_COLOR[opts.score] ?? "#8C8C8C", flex: 2 }] : []),
          ],
        },
        { type: "text", text: `${brandLabel} · ${opts.branchCode}${opts.modelInterest ? " · " + opts.modelInterest : ""}`, size: "xs", color: "#8C8C8C", wrap: true },
        { type: "text", text: "👆 คัดลอกข้อความด้านบนแล้วส่งจาก LINE ตัวเอง", size: "xxs", color: "#8C8C8C", wrap: true, margin: "sm" },
      ],
    },
    footer: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "box", layout: "horizontal", spacing: "xs", contents: [btn("โทรแล้ว", "called", "secondary"), btn("นัดได้", "booked", "primary")] },
        btn("ไม่สนใจ", "not_interested", "secondary"),
      ],
    },
  };
  return { altText: `📋 ตามลูกค้า: ${opts.customerName || "ไม่ระบุชื่อ"}`, contents };
}

// SLA nudge to the owning salesperson — plain text reminder (no draft message
// here; the AI draft comes from WF3 nudge, this is just "you're overdue").
export function buildSlaNudgeText(opts: {
  leadId: number;
  customerName?: string | null;
  daysIdle: number;
}): string {
  return `⏰ เตือนติดตามลูกค้า\nLead #${opts.leadId} — ${opts.customerName || "ไม่ระบุชื่อ"}\nไม่มีการติดต่อมา ${opts.daysIdle} วันแล้ว กรุณาติดตามลูกค้าด่วน`;
}

// Manager escalation — SLA breach with 3 quick-action buttons (handoff §5
// playbook). Postback data carries the lead id; a WF4-style handler resolves
// the fun_sla_event this card is tied to.
export function buildSlaEscalateBubble(opts: {
  leadId: number;
  brand: string;
  branchCode: string;
  customerName?: string | null;
  ownerName?: string | null;
  daysIdle: number;
  temperature?: string | null;
}): { altText: string; contents: Record<string, unknown> } {
  const brandLabel = BRAND_LABELS[opts.brand as BrandKey] ?? opts.brand;
  const btn = (label: string, action: string, style: string) => ({
    type: "button", style, height: "sm",
    action: { type: "postback", label, data: `action=${action}&lead=${opts.leadId}`, displayText: label },
  });
  const contents = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: "#B7472E", paddingAll: "12px",
      contents: [
        { type: "text", text: "🚨 หลุด SLA — ต้องตัดสินใจ", weight: "bold", color: "#FFFFFF", size: "md" },
        { type: "text", text: `${brandLabel} · สาขา ${opts.branchCode}`, color: "#FBD8CE", size: "xs" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: `👤 ${opts.customerName || "ไม่ระบุชื่อ"}`, weight: "bold", size: "sm", wrap: true },
        { type: "text", text: `เซลส์: ${opts.ownerName || "ไม่มีเจ้าของ"}`, size: "xs", color: "#8C8C8C" },
        { type: "text", text: `ไม่มีการติดต่อมา ${opts.daysIdle} วัน${opts.temperature ? ` · ${opts.temperature.toUpperCase()}` : ""}`, size: "xs", color: "#B7472E" },
      ],
    },
    footer: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        { type: "box", layout: "horizontal", spacing: "xs", contents: [btn("เตือนอีกครั้ง", "nudge_again", "secondary"), btn("ย้ายเซลส์", "reassign", "primary")] },
        btn("ยกเว้น (ต้องระบุเหตุผล)", "exempt", "secondary"),
      ],
    },
  };
  return { altText: `🚨 หลุด SLA: ${opts.customerName || "ไม่ระบุชื่อ"} (${opts.daysIdle} วัน)`, contents };
}

export type NewLeadCard = {
  brand: string;
  branchCode: string;
  source: string;
  reopen: boolean;
  customerName?: string | null;
  phone?: string | null;
  modelInterest?: string | null;
  budgetRange?: string | null;
  rawMessage?: string | null;
};

// Build the "new lead" LINE Flex bubble pushed to the sales group. Mirrors the
// design proven in the WF1 test push. The footer restates the firm rule that AI
// never messages the customer — a human sends.
export function buildNewLeadFlex(c: NewLeadCard): { altText: string; contents: Record<string, unknown> } {
  const brandLabel = BRAND_LABELS[c.brand as BrandKey] ?? c.brand;
  const row = (label: string, value?: string | null) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#8C8C8C", flex: 2 },
      { type: "text", text: value || "-", size: "sm", color: "#222222", flex: 5, wrap: true },
    ],
  });

  const contents = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: "#06C755", paddingAll: "12px",
      contents: [
        { type: "text", text: c.reopen ? "🔁 ลูกค้าเดิมทักซ้ำ" : "🚗 Lead ใหม่", weight: "bold", color: "#FFFFFF", size: "md" },
        { type: "text", text: `${brandLabel} · สาขา ${c.branchCode}`, color: "#E8FFE8", size: "xs" },
      ],
    },
    body: {
      type: "box", layout: "vertical", spacing: "md",
      contents: [
        row("ชื่อ", c.customerName),
        row("โทร", c.phone),
        row("รุ่นที่สนใจ", c.modelInterest),
        row("งบประมาณ", c.budgetRange),
        row("ที่มา", SOURCE_LABEL[c.source] ?? c.source),
        row("ข้อความ", c.rawMessage ? c.rawMessage.slice(0, 200) : "-"),
      ],
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        { type: "text", text: "ระบบจะส่งร่างข้อความ follow-up ให้ทุกเช้า — AI ไม่ทักลูกค้าเอง เซลล์เป็นคนส่งเสมอ", size: "xxs", color: "#8C8C8C", wrap: true },
      ],
    },
  };

  const altText = `${c.reopen ? "🔁 ลูกค้าเดิมทักซ้ำ" : "🚗 Lead ใหม่"}: ${c.customerName || "ไม่ระบุชื่อ"} (${brandLabel})`;
  return { altText, contents };
}

// Customer-consent ownership switch (user req 2026-07-10): sent to the
// CUSTOMER (not staff) when they scan a second salesperson's QR for a brand
// they already have an active lead+salesperson for. Two postback buttons —
// the request stays 'pending' (owner unchanged) until they tap one; see
// src/app/api/webhooks/line/route.ts's owner-switch postback branch.
export function buildOwnerConsentBubble(opts: {
  requestId: number;
  currentOwnerName: string;
  offeredOwnerName: string;
}): { altText: string; contents: Record<string, unknown> } {
  const btn = (label: string, action: string, style: string) => ({
    type: "button", style, height: "sm",
    action: { type: "postback", label, data: `action=${action}&req=${opts.requestId}`, displayText: label },
  });
  const contents = {
    type: "bubble",
    body: {
      type: "box", layout: "vertical", spacing: "sm",
      contents: [
        { type: "text", text: `ระบบพบว่าท่านมี ${opts.currentOwnerName} เป็นผู้ดูแลอยู่แล้ว`, size: "sm", wrap: true },
        { type: "text", text: "ท่านต้องการทำรายการต่ออย่างไร?", size: "sm", wrap: true, margin: "sm" },
      ],
    },
    footer: {
      type: "box", layout: "vertical", spacing: "xs",
      contents: [
        btn(`คุยกับ ${opts.currentOwnerName} คนเดิม`, "keep_owner", "secondary"),
        btn(`เปลี่ยนผู้ดูแลเป็น ${opts.offeredOwnerName}`, "switch_owner", "primary"),
      ],
    },
  };
  return { altText: `ยืนยันผู้ดูแล: ${opts.currentOwnerName} หรือ ${opts.offeredOwnerName}?`, contents };
}

// Quotation PDF card (user req 2026-07-12) — replaces a plain text message +
// raw link with a proper Flex bubble + button, matching the app's own teal
// card style (own header wording/layout, not modeled on any one dealer
// system's card — see 2026-07-12 review). Row set (customer, model,
// dealer, date, quote no.) covers what a customer needs to recognize the
// offer at a glance before opening the PDF for the full breakdown. The
// button's uri action is what the customer taps; the PDF itself is served
// as an attachment (not inline) so LINE's in-app browser downloads it to
// the device's own PDF viewer instead of trying (and failing) to render it
// inline.
// Restyled 2026-07-13 (user req): light-yellow header + soft-orange button —
// was teal-green; and NO net total on the card. Price talk stays inside the
// PDF/negotiation; the card is just the door.
export function buildQuotePdfBubble(opts: {
  quoteNo: string;
  customerName: string;
  companyName: string;
  createdAt: Date | null;
  variant?: string | null;
  color?: string | null;
  pdfUrl: string;
}): { altText: string; contents: Record<string, unknown> } {
  const dateLabel = opts.createdAt
    ? `${opts.createdAt.getDate()}/${opts.createdAt.getMonth() + 1}/${opts.createdAt.getFullYear() + 543}`
    : null;
  const row = (label: string, value: string) => ({
    type: "box", layout: "baseline", spacing: "sm",
    contents: [
      { type: "text", text: label, size: "xs", color: "#8C8C8C", flex: 2 },
      { type: "text", text: value, size: "xs", color: "#222222", flex: 3, wrap: true },
    ],
  });

  const rows: Record<string, unknown>[] = [row("ลูกค้า", opts.customerName)];
  if (opts.variant) rows.push(row("รุ่นรถ", `${opts.variant}${opts.color ? ` · สี${opts.color}` : ""}`));
  rows.push(row("ผู้เสนอ", opts.companyName));
  if (dateLabel) rows.push(row("วันที่ออกเอกสาร", dateLabel));
  rows.push(row("เลขที่เอกสาร", opts.quoteNo));

  const contents = {
    type: "bubble",
    header: {
      type: "box", layout: "vertical", backgroundColor: "#FDF3D8", paddingAll: "14px",
      contents: [
        { type: "text", text: "รายละเอียดข้อเสนอซื้อรถของคุณ", weight: "bold", color: "#8A5A00", size: "md", wrap: true },
      ],
    },
    body: { type: "box", layout: "vertical", spacing: "sm", contents: rows },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        { type: "button", style: "primary", height: "sm", color: "#F2A65A",
          action: { type: "uri", label: "ดูรายละเอียดฉบับเต็ม", uri: opts.pdfUrl } },
      ],
    },
  };
  return { altText: `ใบเสนอราคา ${opts.quoteNo} — คุณ ${opts.customerName}`, contents };
}
