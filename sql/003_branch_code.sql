-- Patch: fun_channel_config routes by branch_code (VARCHAR, e.g. 'NPT') but
-- fun_branch had no code column — add it so the app can resolve channel_config
-- rows to branch_id. Codes are filled lazily (ingest auto-creates a branch row
-- for an unknown code; rename branch_name later in UI/SQL as needed).
USE ch_lead_fun;
ALTER TABLE fun_branch ADD COLUMN branch_code VARCHAR(10) NULL UNIQUE AFTER branch_name;
