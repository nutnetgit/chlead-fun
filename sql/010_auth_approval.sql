-- LINE-Login registration + admin approval (user req 2026-07-07):
-- first LINE sign-in auto-creates a PENDING fun_user (approved_at NULL);
-- admin assigns role/branches and approves in /settings/users. picture_url
-- comes from the LINE profile. Existing (demo) users are marked approved so
-- pickers keep working.
USE ch_lead_fun;

ALTER TABLE fun_user
  ADD COLUMN approved_at DATETIME NULL,
  ADD COLUMN picture_url VARCHAR(500) NULL;

UPDATE fun_user SET approved_at = NOW() WHERE approved_at IS NULL;
