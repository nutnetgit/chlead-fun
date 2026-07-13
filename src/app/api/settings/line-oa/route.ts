import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Display order (user req 2026-07-11): oldest/established brands first,
// newest last — matches how the team thinks about the lineup, not
// alphabetical. Any brand not listed here (future additions) sorts after
// these, alphabetically.
const BRAND_ORDER = ["Mazda", "Ford", "Mitsubishi", "GWM", "Deepal", "KIA", "GAC", "Lepas"];

/**
 * Per-brand LINE OA directory (user req 2026-07-11) — see sql/019 and
 * src/lib/lineConfig.ts. Tokens/secrets are write-only from the client's
 * perspective: this list only ever returns whether a brand is configured
 * and a masked tail of the access token, never the raw secret.
 */
// Monthly push-quota usage per OA (user req 2026-07-13 — "which sends eat
// quota and how close are we"): LINE's quota endpoints, called with each
// brand's own token. Push messages count against the plan's monthly cap;
// webhook inbound + replies via OA Manager's chat screen are free.
async function fetchQuota(token: string): Promise<{ limit: number | null; used: number | null }> {
  try {
    const [quotaRes, usedRes] = await Promise.all([
      fetch("https://api.line.me/v2/bot/message/quota", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("https://api.line.me/v2/bot/message/quota/consumption", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const quota = quotaRes.ok ? await quotaRes.json() : null;
    const used = usedRes.ok ? await usedRes.json() : null;
    return {
      limit: quota?.type === "limited" ? quota.value : null, // null = unlimited plan
      used: typeof used?.totalUsage === "number" ? used.totalUsage : null,
    };
  } catch {
    return { limit: null, used: null };
  }
}

export async function GET() {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const brands = await prisma.brand.findMany({
    orderBy: { brandName: "asc" },
    include: { lineConfig: true },
  });
  brands.sort((a, b) => {
    const ia = BRAND_ORDER.indexOf(a.brandName), ib = BRAND_ORDER.indexOf(b.brandName);
    if (ia === -1 && ib === -1) return a.brandName.localeCompare(b.brandName);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const rows = await Promise.all(brands.map(async (b) => {
    const quota = b.lineConfig?.channelAccessToken
      ? await fetchQuota(b.lineConfig.channelAccessToken)
      : { limit: null, used: null };
    return {
      brandId: b.brandId,
      brandName: b.brandName,
      messagingConfigured: !!(b.lineConfig?.channelAccessToken && b.lineConfig?.channelSecret),
      isActive: !!b.lineConfig?.isActive,
      destination: b.lineConfig?.destination ?? null,
      accessTokenTail: b.lineConfig?.channelAccessToken ? b.lineConfig.channelAccessToken.slice(-4) : null,
      liffId: b.lineConfig?.liffId ?? null,
      updatedAt: b.lineConfig?.updatedAt ?? null,
      quotaLimit: quota.limit,
      quotaUsed: quota.used,
    };
  }));

  return NextResponse.json(rows);
}
