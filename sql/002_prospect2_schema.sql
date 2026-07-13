-- ============================================================================
-- Prospect 2.0 — schema bootstrap (prospect2_handoff.md + prospect2-schema-design.md)
-- Target: database `ch_lead_fun` on mariadb-erawan (decided 2026-07-06 — the
-- doc's `ch_erawan_schema` does not exist; ch_lead_fun is Prospect's own DB).
--
-- Deviations from the schema doc (per prospect2_handoff.md §3 + user decisions):
--   * Group F reduced: fun_booking / fun_dms_sync_log / reconcile CUT — replaced
--     by fun_booking_handoff (funnel ends at stage 'booking'; finance keys SPS
--     manually via a summary page and confirms in-app).
--   * fun_source_channel.category adds 'unknown' (legacy '' rows per §4.1).
--   * fun_lead adds fb_leadgen_id / fb_page_id (FB adapter dedup, §4.2).
--   * SLA seeded LOOSE (~2× of §5) for month 1 — tighten later by UPDATEing
--     fun_sla_rule, no code change.
--   * Drops Ch.Lead FUN's fun_leads / fun_lead_activities / fun_nudge_log
--     (all verified 0 rows, 2026-07-06). fun_channel_config + fun_settings KEPT.
--
-- Run as root:  mysql ch_lead_fun < 002_prospect2_schema.sql
-- ============================================================================

USE ch_lead_fun;

-- ── Drop superseded Ch.Lead FUN tables (children first) ──────────────────────
DROP TABLE IF EXISTS fun_lead_activities;
DROP TABLE IF EXISTS fun_nudge_log;
DROP TABLE IF EXISTS fun_leads;

-- ═══════════════════════════════ GROUP I: DIMENSIONS ════════════════════════
CREATE TABLE IF NOT EXISTS fun_branch (
  branch_id     INT AUTO_INCREMENT PRIMARY KEY,
  branch_name   VARCHAR(100) NOT NULL,
  company_code  VARCHAR(10) NULL,
  is_active     TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fun_brand (
  brand_id    INT AUTO_INCREMENT PRIMARY KEY,
  brand_name  VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS fun_user (
  user_id      INT AUTO_INCREMENT PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  nickname     VARCHAR(50),
  role         ENUM('sales','manager','gm','admin') NOT NULL DEFAULT 'sales',
  branch_id    INT NULL,
  team_id      INT NULL,          -- plain column (no FK) to avoid circular ref with fun_team
  line_userid  VARCHAR(50) NULL,
  is_active    TINYINT DEFAULT 1,
  FOREIGN KEY (branch_id) REFERENCES fun_branch(branch_id)
);

CREATE TABLE IF NOT EXISTS fun_team (
  team_id          INT AUTO_INCREMENT PRIMARY KEY,
  team_name        VARCHAR(100) NOT NULL,
  branch_id        INT NULL,
  manager_user_id  INT NULL,
  FOREIGN KEY (branch_id) REFERENCES fun_branch(branch_id),
  FOREIGN KEY (manager_user_id) REFERENCES fun_user(user_id)
);

CREATE TABLE IF NOT EXISTS fun_model (
  model_id    INT AUTO_INCREMENT PRIMARY KEY,
  brand_id    INT NOT NULL,
  model_name  VARCHAR(100) NOT NULL,
  model_code  VARCHAR(50) NULL,
  FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id)
);

CREATE TABLE IF NOT EXISTS fun_duty_roster (
  roster_id  INT AUTO_INCREMENT PRIMARY KEY,
  branch_id  INT NOT NULL,
  duty_date  DATE NOT NULL,
  user_id    INT NOT NULL,
  slot       VARCHAR(20) NULL,
  FOREIGN KEY (branch_id) REFERENCES fun_branch(branch_id),
  FOREIGN KEY (user_id) REFERENCES fun_user(user_id),
  INDEX idx_duty (branch_id, duty_date)
);

CREATE TABLE IF NOT EXISTS fun_stock_snapshot (
  snap_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  snap_date  DATE NOT NULL,
  branch_id  INT NOT NULL,
  model_id   INT NOT NULL,
  variant    VARCHAR(100) NULL,
  color      VARCHAR(50) NULL,
  qty        INT NOT NULL DEFAULT 0,
  INDEX idx_snap (snap_date, branch_id)
);

CREATE TABLE IF NOT EXISTS fun_kpi_daily (
  kpi_id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  kpi_date               DATE NOT NULL,
  branch_id              INT NOT NULL,
  user_id                INT NULL,
  new_leads              INT DEFAULT 0,
  contacted              INT DEFAULT 0,
  appointments           INT DEFAULT 0,
  test_drives            INT DEFAULT 0,
  quotes                 INT DEFAULT 0,
  bookings               INT DEFAULT 0,
  deliveries             INT DEFAULT 0,
  lost                   INT DEFAULT 0,
  avg_first_response_min INT NULL,
  sla_breaches           INT DEFAULT 0,
  UNIQUE KEY uk_kpi (kpi_date, branch_id, user_id)
);

-- ═══════════════════════════════ GROUP A: CUSTOMER MASTER ═══════════════════
CREATE TABLE IF NOT EXISTS fun_person (
  person_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_type     ENUM('individual','company') NOT NULL DEFAULT 'individual',
  prefix          VARCHAR(20) NULL,
  first_name      VARCHAR(100) NULL,
  last_name       VARCHAR(100) NULL,
  nickname        VARCHAR(50) NULL,
  citizen_id_hash CHAR(64) NULL,        -- SHA-256, dedup without decrypting
  citizen_id_enc  VARBINARY(255) NULL,  -- AES, decrypted ONLY on booking handoff page
  birthdate       DATE NULL,
  occupation      VARCHAR(100) NULL,
  company_name    VARCHAR(200) NULL,
  addr_no         VARCHAR(50) NULL,
  addr_street     VARCHAR(150) NULL,
  addr_tambon     VARCHAR(100) NULL,
  addr_amphur     VARCHAR(100) NULL,
  addr_province   VARCHAR(100) NULL,
  addr_zip        VARCHAR(10) NULL,
  merged_into     BIGINT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by      INT NULL,
  FOREIGN KEY (merged_into) REFERENCES fun_person(person_id),
  INDEX idx_citizen_hash (citizen_id_hash)
);

CREATE TABLE IF NOT EXISTS fun_person_identifier (
  identifier_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id     BIGINT NOT NULL,
  id_type       ENUM('phone','phone2','line_userid','fb_psid','tiktok_id','email') NOT NULL,
  id_value      VARCHAR(255) NOT NULL,  -- full value here; ALWAYS mask before external AI (PDPA)
  is_primary    TINYINT DEFAULT 0,
  verified_at   DATETIME NULL,
  UNIQUE KEY uk_identifier (id_type, id_value),
  FOREIGN KEY (person_id) REFERENCES fun_person(person_id)
);

CREATE TABLE IF NOT EXISTS fun_person_consent (
  consent_id  BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id   BIGINT NOT NULL,
  purpose     ENUM('contact_sales','marketing','analytics') NOT NULL,
  channel     ENUM('any','phone','line','sms','email') NOT NULL DEFAULT 'any',
  status      ENUM('given','withdrawn') NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  recorded_by VARCHAR(100) NULL,
  source_note VARCHAR(255) NULL,
  FOREIGN KEY (person_id) REFERENCES fun_person(person_id),
  INDEX idx_consent (person_id, purpose, status)
);

-- ═══════════════════════════════ GROUP B: SOURCE & CAMPAIGN ═════════════════
CREATE TABLE IF NOT EXISTS fun_source_channel (
  channel_id   INT AUTO_INCREMENT PRIMARY KEY,
  category     ENUM('walkin','phone','online_owned','online_paid','oem','event','referral','service','fleet','unknown') NOT NULL,
  channel_name VARCHAR(100) NOT NULL,
  is_active    TINYINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fun_campaign (
  campaign_id   INT AUTO_INCREMENT PRIMARY KEY,
  campaign_name VARCHAR(200) NOT NULL,
  channel_id    INT NULL,
  brand_id      INT NULL,
  start_date    DATE NULL,
  end_date      DATE NULL,
  budget        DECIMAL(12,2) NULL,
  actual_cost   DECIMAL(12,2) NULL,
  utm_code      VARCHAR(100) NULL,
  FOREIGN KEY (channel_id) REFERENCES fun_source_channel(channel_id),
  FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id)
);

-- ═══════════════════════════════ GROUP C: LEAD CORE ═════════════════════════
CREATE TABLE IF NOT EXISTS fun_lost_reason (
  reason_id    INT AUTO_INCREMENT PRIMARY KEY,
  reason_group ENUM('price','competitor','finance_rejected','postponed','no_stock','changed_mind','uncontactable','other') NOT NULL,
  reason_name  VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS fun_lead (
  lead_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  person_id           BIGINT NOT NULL,
  branch_id           INT NOT NULL,
  brand_id            INT NOT NULL,
  channel_id          INT NOT NULL,
  campaign_id         INT NULL,
  referrer_person_id  BIGINT NULL,
  interested_model_id INT NULL,
  interested_variant  VARCHAR(100) NULL,
  interested_color    VARCHAR(50) NULL,
  payment_type        ENUM('cash','finance','undecided') DEFAULT 'undecided',
  budget_min          DECIMAL(12,2) NULL,
  budget_max          DECIMAL(12,2) NULL,
  buy_timeframe       ENUM('within_1m','1_3m','3_6m','over_6m','unknown') DEFAULT 'unknown',
  has_tradein         TINYINT DEFAULT 0,
  stage               ENUM('new','contacted','qualified','appointment','test_drive','negotiation','finance_check','booking','contract','delivered','won','lost','nurture','forfeited') NOT NULL DEFAULT 'new',
  temperature         ENUM('hot','warm','cold') NULL,
  ai_score            TINYINT NULL,
  ai_score_reason     VARCHAR(255) NULL,
  owner_user_id       INT NULL,
  status              ENUM('active','nurture','won','lost','forfeited') NOT NULL DEFAULT 'active',
  lost_reason_id      INT NULL,
  expected_close_date DATE NULL,
  dms_pros_id         INT NULL,
  fb_leadgen_id       VARCHAR(50) NULL,   -- FB adapter dedup/audit (§4.2)
  fb_page_id          VARCHAR(30) NULL,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  first_response_at   DATETIME NULL,
  last_activity_at    DATETIME NULL,
  next_action_at      DATETIME NULL,
  FOREIGN KEY (person_id) REFERENCES fun_person(person_id),
  FOREIGN KEY (branch_id) REFERENCES fun_branch(branch_id),
  FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id),
  FOREIGN KEY (channel_id) REFERENCES fun_source_channel(channel_id),
  FOREIGN KEY (campaign_id) REFERENCES fun_campaign(campaign_id),
  FOREIGN KEY (referrer_person_id) REFERENCES fun_person(person_id),
  FOREIGN KEY (interested_model_id) REFERENCES fun_model(model_id),
  FOREIGN KEY (owner_user_id) REFERENCES fun_user(user_id),
  FOREIGN KEY (lost_reason_id) REFERENCES fun_lost_reason(reason_id),
  INDEX idx_lead_owner (owner_user_id, status),
  INDEX idx_lead_stage (stage),
  INDEX idx_lead_next_action (next_action_at),
  INDEX idx_lead_last_activity (last_activity_at),
  INDEX idx_lead_person (person_id),
  INDEX idx_lead_fb (fb_leadgen_id)
);

CREATE TABLE IF NOT EXISTS fun_lead_stage_history (
  history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id    BIGINT NOT NULL,
  from_stage VARCHAR(20) NULL,
  to_stage   VARCHAR(20) NOT NULL,
  changed_by INT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note       VARCHAR(255) NULL,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_stagehist (lead_id, changed_at)
);

-- ═══════════════════════════════ GROUP D: ACTIVITY ══════════════════════════
CREATE TABLE IF NOT EXISTS fun_activity (
  activity_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id          BIGINT NOT NULL,
  activity_type    ENUM('call_out','call_in','line_msg','fb_msg','sms','visit_showroom','home_visit','test_drive','quote_sent','finance_submitted','tradein_appraised','booking_made','delivery','note','ai_nudge_sent') NOT NULL,
  direction        ENUM('outbound','inbound','internal') DEFAULT 'internal',
  outcome          ENUM('reached','no_answer','busy','wrong_number','line_read','line_no_read','appointment_made','interested','considering','not_interested','asked_stop') NULL,
  summary          VARCHAR(255) NULL,
  detail           TEXT NULL,
  voice_note_url   VARCHAR(500) NULL,
  transcript       TEXT NULL,
  next_action_type ENUM('call','line','visit','test_drive','quote','wait_customer','none') NULL,
  next_action_at   DATETIME NULL,
  created_by       INT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_activity (lead_id, created_at)
);

CREATE TABLE IF NOT EXISTS fun_appointment (
  appointment_id   BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id          BIGINT NOT NULL,
  appt_type        ENUM('showroom_visit','test_drive','home_visit','document_signing','delivery') NOT NULL,
  scheduled_at     DATETIME NOT NULL,
  status           ENUM('scheduled','confirmed','completed','no_show','cancelled','rescheduled') DEFAULT 'scheduled',
  test_drive_model INT NULL,
  notes            VARCHAR(500) NULL,
  created_by       INT NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  FOREIGN KEY (test_drive_model) REFERENCES fun_model(model_id),
  INDEX idx_appt (lead_id, scheduled_at)
);

-- ═══════════════════════════════ GROUP E: COMMERCIAL ════════════════════════
CREATE TABLE IF NOT EXISTS fun_quotation (
  quote_id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id           BIGINT NOT NULL,
  quote_no          VARCHAR(30) NULL,
  version           TINYINT DEFAULT 1,
  model_id          INT NULL,
  variant           VARCHAR(100) NULL,
  color             VARCHAR(50) NULL,
  list_price        DECIMAL(12,2) NULL,
  discount          DECIMAL(12,2) NULL,
  accessories_value DECIMAL(12,2) NULL,
  campaign_id       INT NULL,
  total_price       DECIMAL(12,2) NULL,
  valid_until       DATE NULL,
  status            ENUM('draft','sent','accepted','expired','superseded') DEFAULT 'draft',
  created_by        INT NULL,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  FOREIGN KEY (model_id) REFERENCES fun_model(model_id),
  FOREIGN KEY (campaign_id) REFERENCES fun_campaign(campaign_id),
  INDEX idx_quote (lead_id, version)
);

CREATE TABLE IF NOT EXISTS fun_finance_application (
  finapp_id       BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id         BIGINT NOT NULL,
  financier       VARCHAR(100) NOT NULL,
  down_payment    DECIMAL(12,2) NULL,
  term_months     SMALLINT NULL,
  monthly_est     DECIMAL(10,2) NULL,
  status          ENUM('preparing_docs','submitted','approved','conditional','rejected') DEFAULT 'preparing_docs',
  approved_amount DECIMAL(12,2) NULL,
  decision_at     DATETIME NULL,
  reject_reason   VARCHAR(255) NULL,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_finapp (lead_id)
);

CREATE TABLE IF NOT EXISTS fun_tradein_appraisal (
  appraisal_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id         BIGINT NOT NULL,
  vehicle_brand   VARCHAR(50) NULL,
  vehicle_model   VARCHAR(100) NULL,
  vehicle_year    SMALLINT NULL,
  plate_last4     VARCHAR(10) NULL,
  mileage         INT NULL,
  appraised_value DECIMAL(12,2) NULL,
  appraised_by    INT NULL,
  photos_url      VARCHAR(500) NULL,
  status          ENUM('pending','appraised','accepted','declined') DEFAULT 'pending',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id)
);

-- ═════════════ GROUP F (reduced): BOOKING HANDOFF — funnel ends here ════════
CREATE TABLE IF NOT EXISTS fun_booking_handoff (
  handoff_id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id            BIGINT NOT NULL UNIQUE,
  person_id          BIGINT NOT NULL,
  handoff_no         VARCHAR(30) NULL,
  customer_fullname  VARCHAR(200) NULL,
  customer_addr_full TEXT NULL,
  citizen_id_enc     VARBINARY(255) NULL,  -- decrypted ONLY on the handoff page
  model              VARCHAR(100) NULL,
  variant            VARCHAR(100) NULL,
  color              VARCHAR(50) NULL,
  agreed_price       DECIMAL(12,2) NULL,
  discount           DECIMAL(12,2) NULL,
  accessories_note   TEXT NULL,
  tradein_note       TEXT NULL,
  finance_note       TEXT NULL,
  deposit_expected   DECIMAL(12,2) NULL,
  status             ENUM('ready','sent_to_finance','completed_in_sps','cancelled') DEFAULT 'ready',
  generated_by       INT NULL,
  generated_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at       DATETIME NULL,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  FOREIGN KEY (person_id) REFERENCES fun_person(person_id)
);

-- ═══════════════════════════════ GROUP G: GOVERNANCE ════════════════════════
CREATE TABLE IF NOT EXISTS fun_sla_rule (
  rule_id                INT AUTO_INCREMENT PRIMARY KEY,
  scope_brand_id         INT NULL,
  scope_branch_id        INT NULL,
  apply_temperature      ENUM('hot','warm','cold','any') NOT NULL DEFAULT 'any',
  apply_channel_category VARCHAR(30) NULL,
  first_response_minutes INT NULL,
  followup_interval_days INT NULL,
  idle_nudge_days        INT NULL,
  idle_escalate_days     INT NULL,
  idle_forfeit_days      INT NULL,     -- NULL = never forfeit (→ nurture)
  is_active              TINYINT DEFAULT 1,
  effective_from         DATE NULL,
  FOREIGN KEY (scope_brand_id) REFERENCES fun_brand(brand_id),
  FOREIGN KEY (scope_branch_id) REFERENCES fun_branch(branch_id)
);

CREATE TABLE IF NOT EXISTS fun_sla_event (
  event_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id     BIGINT NOT NULL,
  rule_id     INT NULL,
  event_type  ENUM('first_response_breach','followup_overdue','idle_nudge','idle_escalate','idle_forfeit','forfeit_warning') NOT NULL,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notified_to INT NULL,
  resolved_at DATETIME NULL,
  resolution  ENUM('sales_acted','manager_reassigned','returned_to_pool','exempted') NULL,
  exempted_by INT NULL,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  FOREIGN KEY (rule_id) REFERENCES fun_sla_rule(rule_id),
  INDEX idx_sla_event (lead_id, event_type, detected_at)
);

CREATE TABLE IF NOT EXISTS fun_assignment_history (
  assign_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id      BIGINT NOT NULL,
  from_user_id INT NULL,
  to_user_id   INT NULL,
  reason       ENUM('initial_roundrobin','initial_duty','manual_by_manager','forfeit_reassign','load_balance','staff_resigned','sales_requested') NOT NULL,
  assigned_by  INT NULL,
  assigned_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_assign (lead_id, assigned_at)
);

CREATE TABLE IF NOT EXISTS fun_lead_pool (
  pool_id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id        BIGINT NOT NULL,
  entered_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  entered_reason ENUM('new_unassigned','forfeited','staff_resigned') NOT NULL,
  claimed_by     INT NULL,
  claimed_at     DATETIME NULL,
  priority       TINYINT DEFAULT 0,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_pool (claimed_at, priority)
);

-- ═══════════════════════════════ GROUP H: AI / NUDGE ════════════════════════
CREATE TABLE IF NOT EXISTS fun_nudge_log (
  nudge_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id       BIGINT NOT NULL,
  sales_user_id INT NULL,
  trigger_type  ENUM('followup_due','idle_warning','forfeit_warning','stock_arrived','campaign_match','manager_push') NOT NULL,
  draft_message TEXT NULL,
  ai_model      VARCHAR(50) NULL,
  pushed_at     DATETIME NULL,
  sales_action  ENUM('sent_to_customer','edited_then_sent','ignored','snoozed') NULL,
  acted_at      DATETIME NULL,
  FOREIGN KEY (lead_id) REFERENCES fun_lead(lead_id),
  INDEX idx_nudge (lead_id, pushed_at)
);

-- ═══════════════ TRIGGER: activity INSERT → lead idle counters ══════════════
DROP TRIGGER IF EXISTS trg_activity_touch_lead;
CREATE TRIGGER trg_activity_touch_lead
AFTER INSERT ON fun_activity FOR EACH ROW
UPDATE fun_lead
   SET last_activity_at = NEW.created_at,
       next_action_at   = COALESCE(NEW.next_action_at, next_action_at),
       first_response_at = COALESCE(first_response_at,
         CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at ELSE first_response_at END)
 WHERE lead_id = NEW.lead_id;

-- ═══════════════════════════════ SEEDS ══════════════════════════════════════
-- Brands (6)
INSERT INTO fun_brand (brand_name) VALUES
 ('Mazda'),('Ford'),('Mitsubishi'),('GWM'),('Deepal'),('KIA');

-- Branches — 9 rows per legacy login (handoff §4); more branches = INSERT more
-- rows later, no code change. company_code left NULL until confirmed.
INSERT INTO fun_branch (branch_name) VALUES
 ('Mazda สำนักงานใหญ่'),
 ('Mazda ศาลายา'),
 ('Ford อ้อมใหญ่'),
 ('Mitsubishi ลำพยา'),
 ('Autopro นครปฐม'),
 ('Autopro ศาลายา'),
 ('GWM นครปฐม'),
 ('Deepal ศาลายา'),
 ('KIA นครปฐม');

-- Source channels (§2.1 taxonomy + §4.1 legacy mapping incl. 'unknown')
INSERT INTO fun_source_channel (category, channel_name) VALUES
 ('walkin','Walk-in โชว์รูม'),
 ('walkin','Walk-in เวรรับ'),
 ('phone','โทรเข้า'),
 ('phone','โทรออก (cold call)'),
 ('online_owned','Facebook Page'),
 ('online_owned','LINE OA'),
 ('online_owned','TikTok'),
 ('online_owned','เว็บไซต์บริษัท'),
 ('online_owned','Google Business'),
 ('online_paid','Facebook Lead Ads'),
 ('online_paid','Google Ads'),
 ('online_paid','TikTok Ads'),
 ('online_paid','Marketplace'),
 ('oem','OEM Lead (แบรนด์ส่ง)'),
 ('event','Event / บูธ'),
 ('referral','ลูกค้าแนะนำ'),
 ('referral','พนักงานแนะนำ'),
 ('service','ลูกค้าเก่า / ศูนย์บริการ'),
 ('fleet','ลูกค้าองค์กร / Fleet'),
 ('unknown','Legacy (ไม่ระบุ)');

-- Lost reasons (one starter row per group — เพิ่ม/แก้ผ่าน UI ภายหลัง)
INSERT INTO fun_lost_reason (reason_group, reason_name) VALUES
 ('price','ราคา/ส่วนลดสู้ไม่ได้'),
 ('competitor','เลือกซื้อแบรนด์คู่แข่ง'),
 ('finance_rejected','ไฟแนนซ์ไม่ผ่าน'),
 ('postponed','เลื่อนการตัดสินใจ'),
 ('no_stock','ไม่มีรถ/สีที่ต้องการ'),
 ('changed_mind','เปลี่ยนใจ/ยกเลิกแผนซื้อ'),
 ('uncontactable','ติดต่อไม่ได้'),
 ('other','อื่นๆ');

-- SLA rules — LOOSE month-1 values (~2× of §5). Tighten later with UPDATE only.
-- Final targets (§5): hot 60m/2-3d/4/7/10 · warm 240m/7d/10/14/21 · cold 1440m/30d/40/50/never · oem 15-30m/-/1/2/5
INSERT INTO fun_sla_rule
 (apply_temperature, apply_channel_category, first_response_minutes, followup_interval_days, idle_nudge_days, idle_escalate_days, idle_forfeit_days, is_active, effective_from) VALUES
 ('hot',  NULL,  120,  5,  8, 14, 20, 1, CURDATE()),
 ('warm', NULL,  480, 14, 20, 28, 42, 1, CURDATE()),
 ('cold', NULL, 2880, 60, 80, 100, NULL, 1, CURDATE()),
 ('any', 'oem',   60,  2,  2,  4, 10, 1, CURDATE()),
 ('any', 'online_paid', 60, 2, 2, 4, 10, 1, CURDATE());
