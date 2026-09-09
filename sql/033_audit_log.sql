-- 033: Application audit log (user req 2026-09-09) — who did what, to which
-- record, when, from where, with what result. Append-only: the app only ever
-- INSERTs (and the nightly purge DELETEs rows older than AUDIT_RETENTION_DAYS).
-- Written by src/lib/audit.ts; browsed at /logs → "Audit"; exported as CSV.
--
-- Contents policy (enforced in code, listed here for the DBA): never stores
-- passwords, tokens, SSO tickets, or citizen ids; phone numbers are masked.
--
--   USE ch_lead_fun;

CREATE TABLE IF NOT EXISTS fun_audit_log (
  audit_id      BIGINT       NOT NULL AUTO_INCREMENT,
  at            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor_user_id INT          NULL,
  actor_name    VARCHAR(100) NULL,
  actor_role    VARCHAR(20)  NULL,
  source        VARCHAR(10)  NOT NULL DEFAULT 'web',   -- web | api | job | webhook | sso
  action        VARCHAR(50)  NOT NULL,                 -- dot-namespaced: auth.login, lead.stage, user.perm_change ...
  entity_type   VARCHAR(30)  NULL,
  entity_id     VARCHAR(40)  NULL,
  branch_id     INT          NULL,
  ip            VARCHAR(45)  NULL,
  user_agent    VARCHAR(255) NULL,
  request_id    CHAR(36)     NULL,
  before_json   TEXT         NULL,
  after_json    TEXT         NULL,
  result        VARCHAR(10)  NOT NULL DEFAULT 'ok',    -- ok | denied | error
  detail        VARCHAR(500) NULL,
  PRIMARY KEY (audit_id),
  KEY idx_audit_at (at),
  KEY idx_audit_actor (actor_user_id, at),
  KEY idx_audit_entity (entity_type, entity_id),
  KEY idx_audit_action (action, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional hardening (decide separately — the purge job needs DELETE, so
-- only do this if you move the purge to a root cron instead):
--   REVOKE DELETE, UPDATE ON ch_lead_fun.fun_audit_log FROM 'n8n_fun'@'%';
