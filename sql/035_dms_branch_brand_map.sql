-- 035: map our branches/brands onto SPS's own ids (user req 2026-09-09).
--
-- Why: when a lead is closed the salesperson jumps into SPS's booking form.
-- SPS has NO "current company/brand" of its own — its only tenancy dimension
-- is the BRANCH (`branch.branch_id`), and the brand is derived from it
-- (`branch.sto_br_id` → `stock_brand`). So the handoff has to tell SPS which
-- SPS branch to switch into, which means storing SPS's ids next to ours —
-- the same pattern as fun_user.dms_user_id (sql/032).
--
-- Filled in from /settings/branches (fields "รหัสสาขาใน SPS" / "รหัสยี่ห้อ").
-- Both are optional; a lead whose branch has no mapping simply can't be
-- handed to SPS (the API answers with a clear message instead of landing the
-- salesperson in the wrong showroom).

ALTER TABLE fun_branch
  ADD COLUMN dms_branch_id INT NULL COMMENT 'SPS branch.branch_id',
  ADD UNIQUE KEY uk_branch_dms (dms_branch_id);

ALTER TABLE fun_brand
  ADD COLUMN dms_brand_id INT NULL COMMENT 'SPS stock_brand.sto_br_id',
  ADD UNIQUE KEY uk_brand_dms (dms_brand_id);

-- Reference — SPS production values at the time of writing (adam_prod).
-- Do NOT run blindly: match on what each row really is in this database.
--   stock_brand: 1 Mazda · 2 Ford · 3 Mitsubishi · 8 Isuzu · 13 KIA
--                14 GWM · 15 Deepal · 21 Lepas
--   branch:      1 มาสด้า สำนักงานใหญ่ (sto_br_id 1) · 2 มาสด้า ศาลายา (1)
--                3 ฟอร์ด อ้อมใหญ่ (2) · 4 มิตซู ลำพยา (3)
--                5 ออโตโปร นครปฐม (1) · 6 ออโตโปร ศาลายา (1)
--                7 GWM นครปฐม (14) · 8 Deepal ศาลายา (15)
--                9 KIA นครปฐม (13) · 10 Lepas นครปฐม (21)
