-- Per-brand LIFF (user req 2026-07-11) — adds the LINE Login channel's LIFF
-- app id to the same per-brand config row as the Messaging credentials
-- (sql/019). Independent field: a brand's LIFF can be set up before or after
-- its Messaging token/secret, so channel_access_token/channel_secret are
-- relaxed to nullable too (a LIFF-only row is now valid — messaging falls
-- back to the legacy env vars as before, see src/lib/lineConfig.ts).
ALTER TABLE fun_brand_line_config
  MODIFY channel_access_token VARCHAR(255) NULL,
  MODIFY channel_secret VARCHAR(100) NULL,
  ADD COLUMN liff_id VARCHAR(50) NULL AFTER destination;
