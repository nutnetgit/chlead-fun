-- Cross-brand transfer (design approved 2026-07-07):
--   * the OLD lead closes as lost with a dedicated 'switched_brand' reason
--     (excluded from real lost-reason analytics — it's an internal save, not
--     a loss) and the NEW lead in the target brand links back via
--     origin_lead_id. Same person, same owner; credit follows the salesperson,
--     visibility follows the lead's brand, ownership grants lead-scoped access.
--   * fun_person_identifier gains 'line_id' — the customer-typed LINE ID from
--     the QR form (NOT the same thing as 'line_userid', the internal push id).
USE ch_lead_fun;

ALTER TABLE fun_lead
  ADD COLUMN origin_lead_id BIGINT NULL,
  ADD CONSTRAINT fk_lead_origin FOREIGN KEY (origin_lead_id) REFERENCES fun_lead(lead_id);

INSERT INTO fun_lost_reason (reason_group, reason_name)
  VALUES ('switched_brand', 'ย้ายไปจบอีกยี่ห้อในเครือ (internal save)');

ALTER TABLE fun_person_identifier
  MODIFY COLUMN id_type ENUM('phone','phone2','line_userid','line_id','fb_psid','tiktok_id','email') NOT NULL;
