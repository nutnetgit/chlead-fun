-- ============================================================================
-- Ch.Lead FUN — schema bootstrap (handoff §3, adapted)
-- Target: MariaDB container `mariadb-erawan` on Synology DS1621+ (host :3308)
--
-- DESIGN NOTE (decided 2026-07-04): Ch.Lead FUN gets its OWN dedicated database
-- `ch_lead_fun` in the SAME mariadb-erawan server as the other projects — NOT
-- mixed into the shared `ch_erawan` DB (which already holds mk_*/bs_* tables).
-- The handoff said `ch_erawan_schema`, but that DB doesn't exist; the real
-- shared DB is `ch_erawan`. A separate DB gives stronger isolation: user
-- `n8n_fun` can only touch `ch_lead_fun` — never ch_erawan / gear_ats.
--
-- Run once as root (from the NAS shell):
--   /usr/local/bin/docker exec -i mariadb-erawan \
--     mysql -uroot -p'<ROOT_PW>' < 001_fun_schema.sql
--
-- IMPORTANT: replace <N8N_FUN_PASSWORD> below before running.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS ch_lead_fun
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ch_lead_fun;

-- Channel routing: which FB page maps to which brand/branch/LINE group/Sheet
-- (pattern borrowed from Nong Count's group_config — dynamic, no code changes
-- to add a brand)
CREATE TABLE IF NOT EXISTS fun_channel_config (
  config_id INT AUTO_INCREMENT PRIMARY KEY,
  fb_page_id VARCHAR(30) NOT NULL UNIQUE,
  fb_page_name VARCHAR(100),
  brand VARCHAR(20) NOT NULL,              -- mazda/ford/mitsubishi/gwm/deepal/kia
  branch_code VARCHAR(10) NOT NULL,
  line_group_id VARCHAR(50) NOT NULL,      -- destination sales LINE group
  gsheet_id VARCHAR(100),                  -- destination spreadsheet (per brand or shared)
  active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fun_leads (
  lead_id INT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('facebook','messenger','line_oa','walkin','phone','referral','website') NOT NULL,
  fb_leadgen_id VARCHAR(50),               -- Meta leadgen id for dedupe/audit
  fb_page_id VARCHAR(30),
  brand VARCHAR(20) NOT NULL,
  branch_code VARCHAR(10) NOT NULL,
  customer_name VARCHAR(100),
  phone VARCHAR(20),
  line_user_id VARCHAR(50),
  model_interest VARCHAR(50),
  budget_range VARCHAR(50),
  raw_message TEXT,
  score ENUM('hot','warm','cold') DEFAULT NULL,
  score_reason VARCHAR(255),
  status ENUM('new','assigned','contacted','appointment','test_drive','negotiation','won','lost','dormant') DEFAULT 'new',
  assigned_to INT,
  consent_flag TINYINT DEFAULT 0,
  consent_date DATETIME,
  next_followup_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone_brand (phone, brand)
);
-- Dedupe policy (lesson from Nong Count UNIQUE KEY bug): a repeat inquiry must
-- NOT fail. Writers must use INSERT ... ON DUPLICATE KEY UPDATE status='new',
-- next_followup_date=CURDATE(), updated_at=NOW() and log a 'reopen' activity.

CREATE TABLE IF NOT EXISTS fun_lead_activities (
  activity_id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  staff_id INT,
  activity_type ENUM('note','call','line_sent','appointment','test_drive','status_change','ai_draft','reopen'),
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_leads(lead_id),
  INDEX idx_lead_created (lead_id, created_at)
);

CREATE TABLE IF NOT EXISTS fun_nudge_log (
  nudge_id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  staff_id INT,
  draft_text TEXT,
  sent_flag TINYINT DEFAULT 0,
  response_flag ENUM('answered','no_answer','appointment','not_interested') DEFAULT NULL,
  nudge_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_leads(lead_id),
  INDEX idx_nudge_date (nudge_date)
);

-- App-level settings. NON-SECRET config + token health only (handoff §7):
-- real secrets live in n8n credentials (Phase 1) → app secret store (Phase 3).
CREATE TABLE IF NOT EXISTS fun_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------------------------
-- Dedicated user for n8n + the Settings app. Scoped to the whole ch_lead_fun
-- database (which is entirely ours) — cannot reach any other project's DB.
-- '%' host so both the n8n container and the FUN app container can connect.
-- ----------------------------------------------------------------------------
CREATE USER IF NOT EXISTS 'n8n_fun'@'%' IDENTIFIED BY 'Er@w@n12345';
GRANT SELECT, INSERT, UPDATE, DELETE ON ch_lead_fun.* TO 'n8n_fun'@'%';
FLUSH PRIVILEGES;
