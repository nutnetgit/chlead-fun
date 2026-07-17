// Brands are NOT fixed — new ones get added freely via /settings/branches
// (a row in the live Brand table, e.g. GAC/Lepas added after this list was
// first written). This BRANDS/BRAND_LABELS pair is only a display-label
// fallback for flex.ts's Flex card builders now (BRAND_LABELS[x] ?? x) —
// the Channels page used to treat this as the authoritative brand list for
// its dropdown, which is exactly why it silently couldn't map GAC/Lepas to
// any channel; rebuilt 2026-07-15 to source brands live from /api/branches
// instead. Keep this list in sync manually when a brand's display casing
// needs to differ from Prisma's stored brandName (rare) — the ?? fallback
// means a brand missing here still displays fine, just using its raw
// brandName instead of a curated label.
export const BRANDS = ["mazda", "ford", "mitsubishi", "gwm", "deepal", "kia", "gac", "lepas"] as const;
export type BrandKey = (typeof BRANDS)[number];

export const BRAND_LABELS: Record<BrandKey, string> = {
  mazda: "Mazda",
  ford: "Ford",
  mitsubishi: "Mitsubishi",
  gwm: "GWM",
  deepal: "Deepal",
  kia: "Kia",
  gac: "GAC",
  lepas: "Lepas",
};

// Health snapshots written by n8n into fun_settings (handoff §5.2):
//   fb_token_health   ← weekly /debug_token check
//   line_bot_health   ← LINE bot info call
//   sheets_health     ← Sheets service-account access check
//   line_last_group_id ← group-ID capture (app webhook or WF4)
export type HealthStatus = {
  ok: boolean;
  checkedAt?: string;
  detail?: string;
};
