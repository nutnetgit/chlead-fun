import crypto from "crypto";

// Verify LINE's X-Line-Signature over the EXACT raw request body (handoff §7
// — any postback that mutates lead data MUST verify this, unlike the
// non-secret Group-ID capture path). LINE signs with HMAC-SHA256 + base64
// (not hex like Meta), keyed by the Channel Secret (Basic settings — a
// DIFFERENT credential from the Channel access token used to push messages).
export function verifyLineSignature(rawBody: string, signatureHeader: string | null, channelSecret: string): boolean {
  if (!signatureHeader || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function lineReply(token: string, replyToken: string, messages: Record<string, unknown>[]): Promise<boolean> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
