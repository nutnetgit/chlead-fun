-- ADR-011 — temperature (human) vs ai_score (Gemini) conflict handling.
-- Distance >1 tier (Hot<->Cold) forces temperature to Warm + flags it visibly
-- everywhere the lead card renders; distance <=1 tier leaves the human's
-- setting alone. sla_override records a forced/human-confirmed override with
-- a mandatory reason, in the same append-only activity timeline.
USE ch_lead_fun;

ALTER TABLE fun_lead
  ADD COLUMN temperature_conflict TINYINT DEFAULT 0 AFTER temperature;

ALTER TABLE fun_activity
  MODIFY COLUMN activity_type ENUM(
    'call_out','call_in','line_msg','fb_msg','sms','visit_showroom','home_visit',
    'test_drive','quote_sent','finance_submitted','tradein_appraised','booking_made',
    'delivery','note','ai_nudge_sent','sla_override'
  ) NOT NULL;
