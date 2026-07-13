-- Per-brand LINE OA (user req 2026-07-11): each BRAND now runs its own LINE
-- Official Account, shared by every branch that sells that brand, so sales
-- stay with a customer until the customer decides, instead of chat/leads
-- mixing across brands whenever a customer's QR scans land on different
-- brands. (Corrected same session from an earlier per-BRANCH design — a
-- brand's OA is shared across its branches, not split further per branch.)
-- `destination` is the channel's own bot userId (LINE Developers Console >
-- Messaging API tab > "Bot user ID"), included on every inbound webhook
-- request body — used to route an event to the right brand without
-- depending on the customer's (per-channel-scoped) line_userid alone, since
-- LINE issues a DIFFERENT userId per channel for the same physical customer.
-- Rollout is brand-by-brand, not a big-bang cutover: a brand with no row
-- here (or is_active=0) falls back to the legacy single-OA env vars
-- (LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET) — see src/lib/lineConfig.ts.
CREATE TABLE fun_brand_line_config (
  brand_id INT PRIMARY KEY,
  destination VARCHAR(50) NULL UNIQUE,
  channel_access_token VARCHAR(255) NOT NULL,
  channel_secret VARCHAR(100) NOT NULL,
  is_active TINYINT DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id)
);
