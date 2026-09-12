import crypto from "crypto";

/**
 * Shared-secret check for the machine-to-machine endpoints (n8n cron triggers,
 * the lead-ingest webhook). Security review 2026-09-12: every one of those
 * routes used to read
 *
 *     if (process.env.WEBHOOK_SECRET && key !== process.env.WEBHOOK_SECRET) → 401
 *
 * which means an empty or missing WEBHOOK_SECRET left them open to anyone on
 * the internet — the job routes send LINE messages and rewrite lead data, so
 * that is a real hole the day a deploy loses its env file. This fails CLOSED:
 * no secret configured = nobody gets in, and the comparison is timing-safe.
 */
export function checkWebhookKey(headerValue: string | null): boolean {
  const expected = process.env.WEBHOOK_SECRET ?? "";
  if (!expected || !headerValue) return false;
  // Hash both sides first so a length mismatch can't short-circuit the compare.
  const a = crypto.createHash("sha256").update(headerValue, "utf8").digest();
  const b = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(a, b);
}
