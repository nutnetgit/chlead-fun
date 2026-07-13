-- Sample lineup for the 2 new brands (user req 2026-07-11) — placeholders to
-- unblock testing the QR/lead flow; edit freely at /settings/models.
-- GAC models are the real current Thailand lineup (GAC Aion sub-brand EVs +
-- GAC Motor). Lepas model names are GENERIC PLACEHOLDERS — not verified
-- against a real published lineup, rename via /settings/models once known.
SET @gac=(SELECT brand_id FROM fun_brand WHERE brand_name='GAC');
SET @lp=(SELECT brand_id FROM fun_brand WHERE brand_name='Lepas');

INSERT INTO fun_model (brand_id, model_name) VALUES
 (@gac,'AION Y Plus'),(@gac,'AION V'),(@gac,'Empow'),(@gac,'GS3 Emzoom'),(@gac,'M8'),(@gac,'GS8'),
 (@lp,'Model 1'),(@lp,'Model 2'),(@lp,'Model 3');

-- common colors for every model just added (per-model rows so each can diverge later)
INSERT INTO fun_vehicle_color (model_id, color_name)
SELECT m.model_id, c.n FROM fun_model m
CROSS JOIN (SELECT 'ขาว' AS n UNION SELECT 'ดำ' UNION SELECT 'เทา' UNION SELECT 'แดง' UNION SELECT 'น้ำเงิน') c
WHERE m.brand_id IN (@gac, @lp);

SELECT CONCAT('models=',(SELECT COUNT(*) FROM fun_model WHERE brand_id IN (@gac,@lp))) AS result;
