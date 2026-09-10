-- 036: SPS colour code on our colour rows (user req 2026-09-10).
--
-- The nightly catalogue sync (src/lib/jobs/dmsCatalogSync.ts) mirrors SPS's
-- stock_color into fun_vehicle_color. SPS staff identify a colour by its
-- manufacturer code (A2W, 36C, SH8 …) as much as by its name, and the same
-- name can repeat across nameplates, so we keep the code alongside the name.
-- dms_color_id already holds SPS's stock_color.sto_co_id.

ALTER TABLE fun_vehicle_color
  ADD COLUMN color_code VARCHAR(20) NULL COMMENT 'SPS stock_color.sto_co_code';
