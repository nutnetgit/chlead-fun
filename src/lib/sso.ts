import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * SSO tickets between Ch.Lead FUN and SPS (user req 2026-09-09) —
 * fun_sso_ticket (sql/034). Contract for the SPS side: docs/SPS_INTEGRATION.md.
 *
 *   out  Lead FUN → SPS : we issue, SPS calls POST /api/sso/verify
 *   in   SPS → Lead FUN : SPS calls POST /api/sso/issue, browser lands on /sso
 *
 * Tickets are 32 random bytes (base64url), single-use, SSO_TICKET_TTL_SEC
 * (default 60 s). Only sha256(ticket) is stored. Consumption is an atomic
 * conditional UPDATE so two racing verifies can't both succeed.
 */
export const SSO_TTL_SEC = Math.max(15, Number(process.env.SSO_TICKET_TTL_SEC ?? 60) || 60);

export const ssoConfig = () => ({
  apiToken: process.env.SSO_API_TOKEN ?? "",
  landingUrl: process.env.SPS_SSO_LANDING_URL ?? "",
  appUrl: (process.env.APP_PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, ""),
});

const sha256 = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

// Timing-safe compare of the SPS shared token (X-Api-Token). Hashing both
// sides first sidesteps the length-mismatch early-exit in timingSafeEqual.
export function checkApiToken(headerValue: string | null): boolean {
  const expected = ssoConfig().apiToken;
  if (!expected || !headerValue) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(headerValue)), Buffer.from(sha256(expected)));
}

export type SsoDirection = "out" | "in";

export async function issueTicket(input: {
  direction: SsoDirection; userId: number; leadId?: bigint | null; handoffId?: bigint | null; target?: string | null; requestId?: string | null;
}): Promise<{ ticket: string; expiresAt: Date }> {
  const ticket = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SSO_TTL_SEC * 1000);
  await prisma.ssoTicket.create({
    data: {
      ticketHash: sha256(ticket),
      direction: input.direction,
      userId: input.userId,
      leadId: input.leadId ?? null,
      handoffId: input.handoffId ?? null,
      target: input.target?.slice(0, 100) ?? null,
      expiresAt,
      requestId: input.requestId ?? null,
    },
  });
  return { ticket, expiresAt };
}

export type SsoError = "TICKET_INVALID" | "TICKET_EXPIRED" | "TICKET_USED";

export async function consumeTicket(ticket: string, direction: SsoDirection, consumerIp: string | null): Promise<
  | { ok: true; row: NonNullable<Awaited<ReturnType<typeof prisma.ssoTicket.findUnique>>> }
  | { ok: false; code: SsoError }
> {
  if (!ticket || ticket.length < 20 || ticket.length > 64) return { ok: false, code: "TICKET_INVALID" };
  const ticketHash = sha256(ticket);
  const row = await prisma.ssoTicket.findUnique({ where: { ticketHash } });
  if (!row || row.direction !== direction) return { ok: false, code: "TICKET_INVALID" };
  if (row.consumedAt) return { ok: false, code: "TICKET_USED" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, code: "TICKET_EXPIRED" };
  const claimed = await prisma.ssoTicket.updateMany({
    where: { ticketHash, consumedAt: null },
    data: { consumedAt: new Date(), consumerIp: consumerIp?.slice(0, 45) ?? null },
  });
  if (claimed.count !== 1) return { ok: false, code: "TICKET_USED" };
  return { ok: true, row };
}

// Housekeeping — tickets are worthless after expiry; keep 7 days for audit
// cross-reference then drop.
export async function purgeSsoTickets(): Promise<number> {
  const r = await prisma.ssoTicket.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 864e5) } } });
  return r.count;
}
