-- Fix for user-reported 2026-07-11 bug: after saving one brand's LINE OA
-- credentials successfully at /settings/line-oa, the rest failed with a
-- generic "บันทึกไม่สำเร็จ" error. Root cause candidates fixed together:
-- 1) channel_access_token VARCHAR(255) was too narrow — LINE's newer
--    stateless (v2.1, JWT-format) channel access tokens can exceed 255
--    characters and were silently truncated/rejected by MySQL.
-- 2) The API's P2002 (unique constraint on `destination`) error detection
--    was unreliable and masked the real error either way (fixed in code,
--    src/app/api/settings/line-oa/[brandId]/route.ts).
ALTER TABLE fun_brand_line_config MODIFY channel_access_token TEXT NULL;
