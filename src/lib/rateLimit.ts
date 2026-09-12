/**
 * Dead-simple in-process rate limiter for the endpoints customers can reach
 * without logging in (security review 2026-09-12: /api/public/lead accepted
 * unlimited submissions, and every accepted one can create a lead, notify a
 * salesperson and send a PAID LINE message — anyone who has scanned one QR
 * code knows the URL and the ids to replay).
 *
 * In-process on purpose: the app runs as a single container, so a shared
 * store would be complexity with no benefit. Consequences to know about —
 * counters reset when the container restarts, and if the app is ever scaled
 * to more than one replica each replica gets its own budget. Neither matters
 * for "stop a script hammering the intake form".
 *
 * Windows are fixed, not sliding: cheap, and the burst that straddles a
 * boundary is not worth the extra code here.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number) {
  // Cheap housekeeping so a long-lived process doesn't grow a map of every
  // IP it has ever seen. Runs at most once a minute.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * Counts one hit against `key` and says whether it is allowed.
 * @returns `retryAfterSec` when the caller has gone over the limit.
 */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  return { ok: true, remaining: limit - b.count, retryAfterSec: 0 };
}

/**
 * Caller IP as seen through the Cloudflare Tunnel. `x-forwarded-for` can be a
 * list; the FIRST entry is the client. It is spoofable in general, but here it
 * is set by our own edge, and an attacker who forges it only splits their own
 * budget — the per-phone limit is the one that actually holds the line.
 */
export function requestIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip") ?? "unknown";
}
