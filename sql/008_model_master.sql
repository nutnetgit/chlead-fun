-- Vehicle model/color master (user requirement 2026-07-07: the old Prospect
-- picks model when adding a lead; master data lived in SPS and had to be
-- re-keyed there for every new model). Strategy: Ch.Lead FUN manages its own
-- master via /settings/models for now; dms_* ref columns are pre-provisioned
-- so a future read-only nightly sync from SPS stock_brand/model/color can
-- match rows without schema changes (blocked until user approves SPS access).
USE ch_lead_fun;

ALTER TABLE fun_model
  ADD COLUMN is_active TINYINT DEFAULT 1,
  ADD COLUMN dms_model_id INT NULL;

CREATE TABLE IF NOT EXISTS fun_vehicle_color (
  color_id     INT AUTO_INCREMENT PRIMARY KEY,
  model_id     INT NOT NULL,
  color_name   VARCHAR(50) NOT NULL,
  is_active    TINYINT DEFAULT 1,
  dms_color_id INT NULL,
  UNIQUE KEY uk_model_color (model_id, color_name),
  FOREIGN KEY (model_id) REFERENCES fun_model(model_id)
);

-- ── seed current lineup (edit freely in /settings/models) ────────────────────
SET @mz=(SELECT brand_id FROM fun_brand WHERE brand_name='Mazda');
SET @fd=(SELECT brand_id FROM fun_brand WHERE brand_name='Ford');
SET @mi=(SELECT brand_id FROM fun_brand WHERE brand_name='Mitsubishi');
SET @gw=(SELECT brand_id FROM fun_brand WHERE brand_name='GWM');
SET @dp=(SELECT brand_id FROM fun_brand WHERE brand_name='Deepal');
SET @ki=(SELECT brand_id FROM fun_brand WHERE brand_name='KIA');

INSERT INTO fun_model (brand_id, model_name) VALUES
 (@mz,'Mazda 2'),(@mz,'Mazda 3'),(@mz,'CX-30'),(@mz,'CX-5'),(@mz,'CX-8'),(@mz,'BT-50'),
 (@fd,'Ranger'),(@fd,'Everest'),(@fd,'Territory'),
 (@mi,'Triton'),(@mi,'Xpander'),(@mi,'Pajero Sport'),(@mi,'Outlander PHEV'),
 (@gw,'Haval H6'),(@gw,'Haval Jolion'),(@gw,'Tank 300'),(@gw,'Ora Good Cat'),
 (@dp,'S07'),(@dp,'L07'),
 (@ki,'Carnival'),(@ki,'Sportage'),(@ki,'Seltos'),(@ki,'Soluto'),(@ki,'EV5');

-- common colors for every model (per-model rows so each can diverge later)
INSERT INTO fun_vehicle_color (model_id, color_name)
SELECT m.model_id, c.n FROM fun_model m
CROSS JOIN (SELECT 'ขาว' AS n UNION SELECT 'ดำ' UNION SELECT 'เทา' UNION SELECT 'แดง' UNION SELECT 'น้ำเงิน') c;

SELECT CONCAT('models=',(SELECT COUNT(*) FROM fun_model),' colors=',(SELECT COUNT(*) FROM fun_vehicle_color)) AS result;
