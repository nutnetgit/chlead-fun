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

  return NextResponse.json(
    brands.map((b) => ({
      brandId: b.brandId,
      brandName: b.brandName,
      messagingConfigured: !!(b.lineConfig?.channelAccessToken && b.lineConfig?.channelSecret),
      isActive: !!b.lineConfig?.isActive,
      destination: b.lineConfig?.destination ?? null,
      accessTokenTail: b.lineConfig?.channelAccessToken ? b.lineConfig.channelAccessToken.slice(-4) : null,
      liffId: b.lineConfig?.liffId ?? null,
      updatedAt: b.lineConfig?.updatedAt ?? null,
    })),
  );
}
