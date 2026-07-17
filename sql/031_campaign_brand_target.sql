-- 031: per-brand lead target for multi-brand events (user req 2026-07-17).
-- fun_campaign.target_leads was a single combined number for the whole
-- event regardless of how many brands attended — Run Rate's per-brand view
-- attributed that FULL number to every attending brand (e.g. a 3-brand event
-- with target_leads=90 showed "90" as each brand's own event-lead target,
-- not a 30/30/30 split). This column lets a manager set each brand's own
-- share directly; fun_campaign.target_leads becomes the DERIVED sum of
-- these (same "derive the aggregate, don't hand-enter it separately"
-- convention already used for Run Rate's team booking target).
ALTER TABLE fun_campaign_brand ADD COLUMN target_leads INT NULL;
