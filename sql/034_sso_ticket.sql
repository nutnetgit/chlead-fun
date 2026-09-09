-- 034: Single-use SSO tickets between Ch.Lead FUN and SPS (user req
-- 2026-09-09). Opaque random ticket, 60 s TTL, one consumption — the SPS
-- side verifies via POST /api/sso/verify (out) or hands the browser to
-- /sso?ticket= (in). Only the SHA-256 of the ticket is stored, never the raw
-- value, same as a password-reset token. See docs/SPS_INTEGRATION.md.
--
--   USE ch_lead_fun;

CREATE TABLE IF NOT EXISTS fun_sso_ticket (
  ticket_hash  CHAR(64)     NOT NULL,                 -- sha256(raw ticket) hex
  direction    VARCHAR(3)   NOT NULL,                 -- out = Lead FUN → SPS · in = SPS → Lead FUN
  user_id      INT          NOT NULL,
  lead_id      BIGINT       NULL,
  handoff_id   BIGINT       NULL,                     -- fun_booking_handoff.handoff_id (out only)
  target       VARCHAR(100) NULL,                     -- in: path to land on after sign-in
  issued_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3)  NOT NULL,
  consumed_at  DATETIME(3)  NULL,
  consumer_ip  VARCHAR(45)  NULL,
  request_id   CHAR(36)     NULL,
  PRIMARY KEY (ticket_hash),
  KEY idx_sso_user (user_id, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
