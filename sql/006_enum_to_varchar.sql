-- Systemic fix for the ENUM(DB)/VarChar(Prisma) mismatch (P2032) first seen on
-- fun_sla_event.resolution (005) and again on fun_activity.outcome (§9 build).
-- Prisma models these status-ish columns as plain String; any column left as
-- DB ENUM throws P2032 the first time a non-NULL value round-trips. Convert
-- every remaining such column to VARCHAR in one pass so this class of bug is
-- gone for good. Columns modeled as true Prisma enums (stage, temperature,
-- activity_type, category, role, ...) are left as DB ENUMs — those match.
USE ch_lead_fun;

ALTER TABLE fun_activity
  MODIFY COLUMN outcome VARCHAR(20) NULL,
  MODIFY COLUMN next_action_type VARCHAR(15) NULL;

ALTER TABLE fun_appointment
  MODIFY COLUMN appt_type VARCHAR(20) NOT NULL,
  MODIFY COLUMN status VARCHAR(15) DEFAULT 'scheduled';

ALTER TABLE fun_quotation
  MODIFY COLUMN status VARCHAR(15) DEFAULT 'draft';

ALTER TABLE fun_finance_application
  MODIFY COLUMN status VARCHAR(20) DEFAULT 'preparing_docs';

ALTER TABLE fun_tradein_appraisal
  MODIFY COLUMN status VARCHAR(10) DEFAULT 'pending';

ALTER TABLE fun_booking_handoff
  MODIFY COLUMN status VARCHAR(20) DEFAULT 'ready';

ALTER TABLE fun_sla_rule
  MODIFY COLUMN apply_temperature VARCHAR(5) NOT NULL DEFAULT 'any';

ALTER TABLE fun_sla_event
  MODIFY COLUMN event_type VARCHAR(25) NOT NULL;

ALTER TABLE fun_assignment_history
  MODIFY COLUMN reason VARCHAR(20) NOT NULL;

ALTER TABLE fun_lead_pool
  MODIFY COLUMN entered_reason VARCHAR(15) NOT NULL;

ALTER TABLE fun_nudge_log
  MODIFY COLUMN sales_action VARCHAR(20) NULL;

ALTER TABLE fun_lost_reason
  MODIFY COLUMN reason_group VARCHAR(20) NOT NULL;
