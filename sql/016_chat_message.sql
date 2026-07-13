-- In-house LINE chat (user req 2026-07-08, ADR-016 groundwork now built out
-- for real): staff reply to customers from inside the app instead of LINE OA
-- Manager. Deliberately a separate table from fun_activity — the existing
-- trg_activity_touch_lead trigger (sql/002) unconditionally bumps
-- last_activity_at on every INSERT regardless of direction, so logging every
-- inbound customer message as an Activity would let customer chatter fake
-- freshness on the SLA idle clock. lead_id is nullable: an inbound message
-- from a LINE user we can't resolve to any lead (never scanned a QR) is still
-- kept, not dropped, for manual triage in the chat inbox.
CREATE TABLE fun_chat_message (
  message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NULL,
  direction VARCHAR(10) NOT NULL,          -- 'inbound' | 'outbound'
  line_user_id VARCHAR(50) NOT NULL,
  sent_by_user_id INT NULL,                -- staff who replied; NULL for inbound
  line_message_id VARCHAR(50) NULL,        -- LINE's own id, dedup on webhook retries
  body TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_line_message (line_message_id),
  INDEX idx_chat_lead (lead_id, created_at)
);
