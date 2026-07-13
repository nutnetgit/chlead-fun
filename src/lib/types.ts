// Brands are fixed company-wide (6 pages today, more later — adding a brand is
// just a new row in fun_channel_config, no code change).
export const BRANDS = ["mazda", "ford", "mitsubishi", "gwm", "deepal", "kia"] as const;
export type BrandKey = (typeof BRANDS)[number];

export const BRAND_LABELS: Record<BrandKey, string> = {
  mazda: "Mazda",
  ford: "Ford",
  mitsubishi: "Mitsubishi",
  gwm: "GWM",
  deepal: "Deepal",
  kia: "Kia",
};

export type ChannelRow = {
  configId: number;
  fbPageId: string;
  fbPageName: string | null;
  brand: string;
  branchCode: string;
  lineGroupId: string;
  gsheetId: string | null;
  active: number | null;
  updatedAt?: string | null;
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
