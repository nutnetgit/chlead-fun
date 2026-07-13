import { prisma } from "@/lib/prisma";
import { verifyLineSignature } from "@/lib/lineAuth";

// Per-brand LINE OA resolution (user req 2026-07-11 — corrected same session
// from per-branch to per-brand: a brand's OA is shared by every branch that
// sells it). See sql/019_brand_line_config.sql for the full rationale.
// Rollout is brand-by-brand: a brand with no row (or is_active=0) falls back
// to the legacy single-OA env vars, so brands not yet migrated keep working
// exactly as before.
export type BrandLineCreds = { accessToken: string; secret: string; brandId: number | null };

function legacyConfig(): BrandLineCreds {
  return { accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "", secret: process.env.LINE_CHANNEL_SECRET ?? "", brandId: null };
}

// For anything that already knows its brand (staff chat reply, welcome push,
// owner-switch consent push) — look up that brand's own OA.
export async function getLineCredsForBrand(brandId: number): Promise<BrandLineCreds> {
  const row = await prisma.brandLineConfig.findUnique({ where: { brandId } });
  if (row?.isActive && row.channelAccessToken && row.channelSecret) {
    return { accessToken: row.channelAccessToken, secret: row.channelSecret, brandId };
  }
  return legacyConfig();
}

// For the inbound webhook, which doesn't know the brand until it resolves
// the event. LINE's console doesn't actually surface a "Bot user ID" field
// anywhere a human can copy it from (confirmed live 2026-07-11 — only Basic
// ID, webhook URL, and the access token are shown), so requiring it as
// manual input was a dead end. Instead:
//   1. Fast path — `destination` (the receiving channel's own bot userId,
//      present on every webhook request body) is matched against whatever
//      we've already auto-learned for a brand.
//   2. Cold path — no match yet (first event ever, or destination changed):
//      try the raw signature against every active brand's channel secret.
//      Only the genuine channel's secret produces a valid HMAC for this
//      exact body, so the first match IS the right brand — persist its
//      destination for the fast path next time.
//   3. Still nothing — fall back to the legacy single-OA env vars, exactly
//      as before, so brands not yet migrated keep working unchanged.
export async function resolveLineCreds(raw: string, signatureHeader: string | null, destination: string | undefined): Promise<BrandLineCreds> {
  if (destination) {
    const row = await prisma.brandLineConfig.findFirst({ where: { destination, isActive: 1 } });
    if (row?.channelAccessToken && row.channelSecret) return { accessToken: row.channelAccessToken, secret: row.channelSecret, brandId: row.brandId };
  }

  const candidates = await prisma.brandLineConfig.findMany({
    where: { isActive: 1, channelSecret: { not: null }, channelAccessToken: { not: null } },
  });
  for (const row of candidates) {
    if (!row.channelSecret || !row.channelAccessToken) continue;
    if (verifyLineSignature(raw, signatureHeader, row.channelSecret)) {
      if (destination && row.destination !== destination) {
        await prisma.brandLineConfig.update({ where: { brandId: row.brandId }, data: { destination } }).catch(() => {});
      }
      return { accessToken: row.channelAccessToken, secret: row.channelSecret, brandId: row.brandId };
    }
  }

  return legacyConfig();
}

// For the public QR / LIFF registration flow — a brand's LIFF app id, or
// null if not configured yet (callers fall back to the legacy single shared
// LIFF app, NEXT_PUBLIC_LIFF_ID).
export async function getLiffIdForBrand(brandId: number): Promise<string | null> {
  const row = await prisma.brandLineConfig.findUnique({ where: { brandId } });
  return row?.liffId ?? null;
}
