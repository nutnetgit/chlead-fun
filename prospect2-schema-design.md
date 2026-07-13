# Prospect 2.0 — Schema Design ฉบับละเอียด
## ออกแบบจากกระบวนการทำงานจริงของฝ่ายขาย

**Ch. Erawan Group** | เอกสารออกแบบฐานข้อมูล v1.0 | ก.ค. 2026
Target: MariaDB (Docker :3307, `ch_erawan_schema`) | Prefix: `fun_` ตามมาตรฐานเดิม

---

# ส่วนที่ 1 — กระบวนการทำงานของฝ่ายขาย (Process First, Schema Second)

ก่อนออกแบบตาราง ต้องเข้าใจว่าเซลส์ทำงานยังไงจริง แล้วให้ schema รองรับทุกจุดของกระบวนการ:

```
[1.ได้ลูกค้ามา] → [2.คัดกรอง/ระบุตัวตน] → [3.มอบหมายเซลส์] → [4.วงจรติดตาม]
     → [5.Milestone: ทดลองขับ/เสนอราคา/เช็คไฟแนนซ์/ตีเทิร์น] → [6.จอง (Booking)]
     → [7.ส่งต่อเข้า DMS] → [8.ส่งมอบ] → [9.กลายเป็นลูกค้าเก่า → วนกลับเป็นแหล่ง lead]
```

หลักการสำคัญ 3 ข้อที่ต่างจาก DMS เดิม:

1. **แยก "คน" ออกจาก "โอกาสขาย"** — ลูกค้าหนึ่งคน (person) มีได้หลายโอกาสขาย (lead) ตลอดชีวิต เช่น มาดู CX-30 ปีนี้ไม่ซื้อ อีก 2 ปีกลับมาดู CX-5 — DMS เดิมผูกทุกอย่างเป็นก้อนเดียว ทำให้ประวัติขาด
2. **ทุกการกระทำเป็น event แบบ append-only** — ไม่มีการแก้ทับ ทุก touch point คือแถวใหม่ → วิเคราะห์ย้อนหลังได้ 100% และเป็น context ให้ AI
3. **กติกา (SLA/rules) เก็บเป็นข้อมูล ไม่ฝังในโค้ด** — ผจก.ปรับเกณฑ์เองได้ต่อแบรนด์/ต่อสาขา ไม่ต้องแก้ระบบ

---

# ส่วนที่ 2 — แหล่งที่มาของลูกค้า (เก็บให้ครบทุกรูปแบบ)

## 2.1 อนุกรมวิธานแหล่ง lead (Source Taxonomy)

ออกแบบเป็น 3 ชั้น: **Category → Channel → Campaign** เพื่อ roll-up รายงานได้ทุกระดับ

| Category | Channel ตัวอย่าง | หมายเหตุ |
|---|---|---|
| `walkin` | walk-in โชว์รูม, walk-in เวรรับ | ผูกกับ duty roster ได้ |
| `phone` | โทรเข้าเบอร์บริษัท (02/034), โทรเข้ามือถือบริษัท, โทรออก (cold call) | แยกขาเข้า/ขาออก |
| `online_owned` | Facebook Page, LINE OA, TikTok, เว็บไซต์บริษัท, Google Business | ช่องทางของเราเอง |
| `online_paid` | Facebook Lead Ads, Google Ads, TikTok Ads, Marketplace | ผูก campaign + cost → คำนวณ ROI |
| `oem` | Lead จากแบรนด์แม่ (Mazda/Ford/Mitsubishi/GWM/Deepal/Kia ส่งมา) | มี SLA แยก มักมีเวลาตอบสนองที่แบรนด์วัด |
| `event` | Motor Expo, Motor Show, บูธห้าง, roadshow, ออกอีเว้นท์ท้องถิ่น | ผูก campaign/อีเว้นท์ |
| `referral` | ลูกค้าแนะนำ, คนรู้จักเซลส์, พนักงานแนะนำ | เก็บ referrer_person_id → ทำโปรแกรมค่าแนะนำได้ |
| `service` | ลูกค้าเก่าเข้าศูนย์บริการ, B&P, ประกันครบกำหนด, ทะเบียนใกล้หมด | วงจร repeat/upsell — จุดแข็งที่ DMS เดิมมีเมนูอยู่แล้วแต่ไม่เชื่อมกลับ |
| `fleet` | ลูกค้าองค์กร/หน่วยงาน | นิติบุคคล ต้องมีฟิลด์บริษัท |

## 2.2 สิ่งที่ต้องเก็บ ณ จุดรับ lead

- **ตัวตน**: ชื่อ (อาจได้แค่ชื่อเล่น), เบอร์โทร, LINE userId, FB PSID — ได้อะไรมาเก็บอันนั้น ไม่บังคับครบ
- **บริบทความสนใจ**: รุ่นที่สนใจ, งบประมาณ, ซื้อสด/จัดไฟแนนซ์, มีรถเทิร์นไหม, กรอบเวลาตัดสินใจ
- **ที่มา**: channel + campaign + utm (ถ้า online) + ใครรับเรื่อง
- **PDPA**: ความยินยอมให้ติดต่อ/ทำการตลาด แยกตามวัตถุประสงค์ พร้อม timestamp — จำเป็นตามกฎหมาย และเป็นเงื่อนไขก่อนยิงข้อความอัตโนมัติทุกชนิด

---

# ส่วนที่ 3 — โครงสร้างตาราง (ฉบับเต็ม 24 ตาราง)

## กลุ่ม A: ตัวตนลูกค้า (Customer Master)

### A1. `fun_person` — ทะเบียนบุคคล (หนึ่งคน = หนึ่งแถว ตลอดชีวิต)
```sql
person_id           BIGINT PK AUTO_INCREMENT
person_type         ENUM('individual','company')
prefix              VARCHAR(20)
first_name          VARCHAR(100)
last_name           VARCHAR(100)
nickname            VARCHAR(50)
citizen_id_hash     CHAR(64)          -- SHA-256 ใช้จับซ้ำ ไม่เก็บเลขจริงตรงๆ
citizen_id_enc      VARBINARY(255)    -- เข้ารหัส AES เปิดได้เฉพาะตอนออกเอกสารจอง
birthdate           DATE NULL
occupation          VARCHAR(100)
company_name        VARCHAR(200) NULL -- กรณี fleet
addr_no, addr_street, addr_tambon, addr_amphur, addr_province, addr_zip
merged_into         BIGINT NULL FK→fun_person  -- dedup: แถวนี้ถูกรวมเข้าแถวไหน
created_at, updated_at, created_by
```
> **Design note:** เลขบัตรเก็บ 2 รูปแบบ — hash สำหรับเทียบซ้ำอัตโนมัติ (ไม่ต้อง decrypt), encrypted สำหรับใช้จริงตอนทำใบจอง แก้ปัญหา PDPA + dedup พร้อมกัน

### A2. `fun_person_identifier` — ช่องทางระบุตัวตน (หลายอันต่อคน)
```sql
identifier_id   BIGINT PK
person_id       FK→fun_person
id_type         ENUM('phone','phone2','line_userid','fb_psid','tiktok_id','email')
id_value        VARCHAR(255)          -- เบอร์เก็บเต็มที่นี่ mask ก่อนส่งออกเสมอ
is_primary      BOOLEAN
verified_at     DATETIME NULL
UNIQUE KEY (id_type, id_value)        -- คีย์จับซ้ำอัตโนมัติ!
```
> คนเดียวมีได้ทั้งเบอร์, LINE, FB — lead จาก Facebook วันนี้กับ walk-in เดือนหน้า จับเป็นคนเดียวกันได้ทันทีถ้าเบอร์ตรง

### A3. `fun_person_consent` — ความยินยอม PDPA
```sql
consent_id      BIGINT PK
person_id       FK
purpose         ENUM('contact_sales','marketing','analytics')
channel         ENUM('any','phone','line','sms','email')
status          ENUM('given','withdrawn')
recorded_at     DATETIME
recorded_by     VARCHAR(100)
source_note     VARCHAR(255)          -- เช่น "เซ็นฟอร์มที่โชว์รูม" / "กดยินยอมใน LINE"
```
> **กติกาเหล็ก:** ระบบ nudge/broadcast ทุกตัวต้อง JOIN ตารางนี้ก่อนส่ง — ไม่มี consent = ไม่ส่ง

## กลุ่ม B: แหล่งที่มาและแคมเปญ

### B1. `fun_source_channel`
```sql
channel_id      INT PK
category        ENUM('walkin','phone','online_owned','online_paid','oem','event','referral','service','fleet')
channel_name    VARCHAR(100)          -- "Facebook Lead Ads", "walk-in โชว์รูม"
is_active       BOOLEAN
```

### B2. `fun_campaign`
```sql
campaign_id     INT PK
campaign_name   VARCHAR(200)
channel_id      FK
brand_id        FK NULL               -- แคมเปญเฉพาะแบรนด์
start_date, end_date
budget          DECIMAL(12,2)
actual_cost     DECIMAL(12,2)
utm_code        VARCHAR(100)
```
> budget + จำนวน lead + จำนวนจอง → **cost per lead / cost per sale ต่อแคมเปญ** อัตโนมัติ — ของที่ DMS เดิมทำไม่ได้เลย

## กลุ่ม C: โอกาสขาย (หัวใจของระบบ)

### C1. `fun_lead` — หนึ่งความสนใจซื้อ = หนึ่ง lead
```sql
lead_id             BIGINT PK
person_id           FK→fun_person
branch_id, brand_id FK
channel_id          FK→fun_source_channel
campaign_id         FK NULL
referrer_person_id  FK NULL           -- กรณี referral: ใครแนะนำมา
interested_model_id FK→fun_model NULL
interested_variant  VARCHAR(100)
interested_color    VARCHAR(50)
payment_type        ENUM('cash','finance','undecided')
budget_min, budget_max  DECIMAL(12,2) NULL
buy_timeframe       ENUM('within_1m','1_3m','3_6m','over_6m','unknown')
has_tradein         BOOLEAN
stage               ENUM('new','contacted','qualified','appointment','test_drive',
                         'negotiation','finance_check','booking','contract',
                         'delivered','won','lost','nurture','forfeited')
temperature         ENUM('hot','warm','cold')      -- ผจก./เซลส์ตั้ง (เก็บ HWC เดิมไว้)
ai_score            TINYINT NULL                    -- 0-100 คะแนน AI (Ch.Lead FUN)
ai_score_reason     VARCHAR(255)                    -- เหตุผลสั้นๆ ที่ AI ให้คะแนน
owner_user_id       FK→fun_user
status              ENUM('active','nurture','won','lost','forfeited')
lost_reason_id      FK→fun_lost_reason NULL
expected_close_date DATE NULL
dms_pros_id         INT NULL          -- ลิงก์กลับ pros_id ใน DMS เดิม (ช่วง transition)
created_at          DATETIME
first_response_at   DATETIME NULL     -- ⏱ วัด SLA ตอบสนองครั้งแรก
last_activity_at    DATETIME NULL     -- ⏱ วัด idle
next_action_at      DATETIME NULL     -- ⏱ นัดครั้งต่อไป — ตัวขับ Ch.Lead FUN
```

### C2. `fun_lead_stage_history` — ทุกครั้งที่ stage เปลี่ยน (append-only)
```sql
history_id      BIGINT PK
lead_id         FK
from_stage, to_stage
changed_by      FK→fun_user
changed_at      DATETIME
note            VARCHAR(255)
```
> ได้ **time-in-stage** ทุกช่วง → รู้ว่า funnel ตันตรงไหน เช่น lead ค้างที่ negotiation เฉลี่ยกี่วันก่อนหลุด

### C3. `fun_lost_reason` — เหตุผลที่เสีย (มาตรฐานเดียวทั้งกลุ่ม)
```sql
reason_id       INT PK
reason_group    ENUM('price','competitor','finance_rejected','postponed','no_stock','changed_mind','uncontactable','other')
reason_name     VARCHAR(100)          -- "แพ้ Haval H6 ราคาโปร", "ไฟแนนซ์ไม่ผ่าน 2 แห่ง"
```
> lost reason แบบ structured → รู้ว่าแพ้เพราะอะไร แบรนด์ไหนโดนคู่แข่งเจ้าไหนกิน — ข้อมูลที่ผู้บริหารไม่เคยมี

## กลุ่ม D: กิจกรรมติดตาม (Activity Log)

### D1. `fun_activity` — ทุก touch point (append-only, ห้าม UPDATE)
```sql
activity_id     BIGINT PK
lead_id         FK
activity_type   ENUM('call_out','call_in','line_msg','fb_msg','sms',
                     'visit_showroom','home_visit','test_drive','quote_sent',
                     'finance_submitted','tradein_appraised','booking_made',
                     'delivery','note','ai_nudge_sent')
direction       ENUM('outbound','inbound','internal')
outcome         ENUM('reached','no_answer','busy','wrong_number','line_read','line_no_read',
                     'appointment_made','interested','considering','not_interested','asked_stop') NULL
summary         VARCHAR(255)          -- หนึ่งบรรทัด สำหรับ timeline
detail          TEXT NULL             -- รายละเอียดเต็ม
voice_note_url  VARCHAR(500) NULL     -- ไฟล์เสียงใน Garage (S3)
transcript      TEXT NULL             -- Sabai/Whisper ถอดเสียง
next_action_type ENUM('call','line','visit','test_drive','quote','wait_customer','none') NULL
next_action_at  DATETIME NULL
created_by      FK→fun_user
created_at      DATETIME
```
> **TRIGGER:** ทุก INSERT อัปเดต `fun_lead.last_activity_at` + `next_action_at` อัตโนมัติ — เซลส์บันทึกที่เดียว ระบบคำนวณ idle เอง

### D2. `fun_appointment` — นัดหมาย (ทดลองขับ/เข้าโชว์รูม/ส่งมอบ)
```sql
appointment_id  BIGINT PK
lead_id         FK
appt_type       ENUM('showroom_visit','test_drive','home_visit','document_signing','delivery')
scheduled_at    DATETIME
status          ENUM('scheduled','confirmed','completed','no_show','cancelled','rescheduled')
test_drive_model FK NULL
notes           VARCHAR(500)
created_by, created_at
```
> no-show rate ต่อเซลส์/ต่อช่องทาง = ตัวชี้คุณภาพ lead และคุณภาพการยืนยันนัด

## กลุ่ม E: Milestone เชิงพาณิชย์

### E1. `fun_quotation` — ใบเสนอราคา (เวอร์ชันได้)
```sql
quote_id        BIGINT PK
lead_id         FK
quote_no        VARCHAR(30)
version         TINYINT
model_id, variant, color
list_price      DECIMAL(12,2)
discount        DECIMAL(12,2)
accessories_value DECIMAL(12,2)       -- ของแถม
campaign_id     FK NULL
total_price     DECIMAL(12,2)
valid_until     DATE
status          ENUM('draft','sent','accepted','expired','superseded')
created_by, created_at
```

### E2. `fun_finance_application` — การจัดไฟแนนซ์
```sql
finapp_id       BIGINT PK
lead_id         FK
financier       VARCHAR(100)          -- ธนาคาร/ลีสซิ่ง
down_payment    DECIMAL(12,2)
term_months     SMALLINT
monthly_est     DECIMAL(10,2)
status          ENUM('preparing_docs','submitted','approved','conditional','rejected')
approved_amount DECIMAL(12,2) NULL
decision_at     DATETIME NULL
reject_reason   VARCHAR(255) NULL
```
> ไฟแนนซ์ไม่ผ่านคือ lost reason อันดับต้นๆ ของตลาดรถไทย — เก็บ structured จะเห็นว่าเจ้าไหนอนุมัติยาก ควรยื่นเจ้าไหนก่อนตาม profile ลูกค้า (ต่อยอดเป็น AI แนะนำ financier ได้)

### E3. `fun_tradein_appraisal` — ตีราคารถเทิร์น (เชื่อมโปรเจกต์ trade-in appraisal ที่วางแผนไว้)
```sql
appraisal_id    BIGINT PK
lead_id         FK
vehicle_brand, vehicle_model, vehicle_year
plate_last4     VARCHAR(10)           -- mask ตามแนว PDPA เดิม
mileage         INT
appraised_value DECIMAL(12,2)
appraised_by    FK→fun_user
photos_url      VARCHAR(500)          -- Garage
status          ENUM('pending','appraised','accepted','declined')
created_at
```

## กลุ่ม F: การจอง และสะพานเชื่อม DMS

### F1. `fun_booking`
```sql
booking_id          BIGINT PK
lead_id             FK UNIQUE
booking_no          VARCHAR(30)       -- เลขจองภายใน Prospect 2.0
booking_date        DATE
deposit_amount      DECIMAL(12,2)
deposit_method      ENUM('cash','transfer','card','qr')
quote_id            FK→fun_quotation  -- ราคาสุดท้ายที่ตกลง
finapp_id           FK NULL
appraisal_id        FK NULL
expected_delivery   DATE NULL
-- ▼ สะพานเชื่อม DMS ▼
dms_booking_ref     VARCHAR(30) NULL  -- เลขใบจองในระบบ Sales System เดิม
dms_sync_status     ENUM('pending_entry','matched','mismatch','manual_review')
dms_matched_at      DATETIME NULL
dms_mismatch_note   VARCHAR(255)
```

### F2. `fun_dms_sync_log` — บันทึกงาน reconcile ทุกคืน
```sql
sync_id         BIGINT PK
sync_type       ENUM('booking_reconcile','delivery_status','stock_snapshot','legacy_lead_import')
run_at          DATETIME
records_read, records_matched, records_mismatch INT
detail_json     JSON
```

## กลุ่ม G: กติกา SLA และการจัดการโดย ผจก. (Governance)

### G1. `fun_sla_rule` — กติกาเก็บเป็นข้อมูล ผจก.ปรับได้เอง
```sql
rule_id                 INT PK
scope_brand_id          FK NULL       -- NULL = ใช้ทุกแบรนด์
scope_branch_id         FK NULL
apply_temperature       ENUM('hot','warm','cold','any')
apply_channel_category  VARCHAR(30) NULL   -- เช่น 'oem' มี SLA เข้มกว่า
first_response_minutes  INT           -- ต้องติดต่อครั้งแรกภายในกี่นาที
followup_interval_days  INT           -- ต้องมี activity ทุกกี่วัน
idle_nudge_days         INT           -- เกินกี่วัน → nudge เซลส์
idle_escalate_days      INT           -- เกินกี่วัน → แจ้ง ผจก.
idle_forfeit_days       INT           -- เกินกี่วัน → ริบเข้า pool
is_active, effective_from
```

### G2. `fun_sla_event` — เหตุการณ์หลุด SLA ที่ระบบตรวจพบ
```sql
event_id        BIGINT PK
lead_id         FK
rule_id         FK
event_type      ENUM('first_response_breach','followup_overdue','idle_nudge','idle_escalate','idle_forfeit','forfeit_warning')
detected_at     DATETIME
notified_to     FK→fun_user NULL
resolved_at     DATETIME NULL
resolution      ENUM('sales_acted','manager_reassigned','returned_to_pool','exempted') NULL
exempted_by     FK NULL               -- ผจก.ยกเว้นได้ แต่มีบันทึกเสมอ
```

### G3. `fun_assignment_history` — ประวัติเปลี่ยนมือ lead
```sql
assign_id       BIGINT PK
lead_id         FK
from_user_id    FK NULL               -- NULL = แจกครั้งแรก
to_user_id      FK NULL               -- NULL = คืนเข้า pool
reason          ENUM('initial_roundrobin','initial_duty','manual_by_manager',
                     'forfeit_reassign','load_balance','staff_resigned','sales_requested')
assigned_by     FK→fun_user
assigned_at     DATETIME
```

### G4. `fun_lead_pool` — คิว lead ไร้เจ้าของ
```sql
pool_id         BIGINT PK
lead_id         FK
entered_at      DATETIME
entered_reason  ENUM('new_unassigned','forfeited','staff_resigned')
claimed_by      FK NULL
claimed_at      DATETIME NULL
priority        TINYINT               -- hot ที่ถูกริบ = priority สูง แจกก่อน
```

## กลุ่ม H: AI / Ch.Lead FUN Integration

### H1. `fun_nudge_log` — ทุกข้อความที่ AI ร่าง
```sql
nudge_id        BIGINT PK
lead_id         FK
sales_user_id   FK
trigger_type    ENUM('followup_due','idle_warning','forfeit_warning','stock_arrived','campaign_match','manager_push')
draft_message   TEXT                  -- ข้อความไทยที่ AI ร่าง
ai_model        VARCHAR(50)           -- 'gemini-3.1-flash-lite' → 'sabai-qwen' ในอนาคต
pushed_at       DATETIME              -- ส่ง Flex carousel ให้เซลส์เมื่อไหร่
sales_action    ENUM('sent_to_customer','edited_then_sent','ignored','snoozed') NULL
acted_at        DATETIME NULL
```
> วัดได้ว่า nudge แบบไหนเซลส์ใช้จริง แบบไหนโดนเมิน → ปรับ prompt ของ AI จากข้อมูลจริง

## กลุ่ม I: Dimension Tables

```sql
fun_branch   (branch_id, branch_name, company_code)     -- 7 สาขา CEA/CEN/MCN/CAX/CAP/CAT
fun_brand    (brand_id, brand_name)                     -- 6 แบรนด์
fun_user     (user_id, display_name, nickname, role ENUM('sales','manager','gm','admin'),
              branch_id, team_id, line_userid, is_active)
fun_team     (team_id, team_name, branch_id, manager_user_id)
fun_model    (model_id, brand_id, model_name, model_code)     -- sync จาก DMS
fun_duty_roster (roster_id, branch_id, duty_date, user_id, slot)  -- เวรรับ walk-in
fun_stock_snapshot (snap_date, branch_id, model_id, variant, color, qty)  -- sync รายวันจาก DMS
fun_kpi_daily (kpi_date, branch_id, user_id, new_leads, contacted, appointments,
               test_drives, quotes, bookings, deliveries, lost,
               avg_first_response_min, sla_breaches)    -- pre-aggregate ให้ dashboard เร็ว
```

---

# ส่วนที่ 4 — กติกา SLA ที่แนะนำ (แทนกฎ 60 วันเดิม)

## ทำไม 60 วันถึงไม่เวิร์ค

กฎเดิม "ไม่บันทึก 60 วัน = สละสิทธิ์" มีปัญหา 3 อย่าง: (1) นานเกินไป — hot lead ตายไปแล้วตั้งแต่สัปดาห์แรก (2) เป็นกฎขาดสิทธิ์อย่างเดียว ไม่มีขั้นเตือนก่อน (3) lead ที่ถูกริบหายไปเฉยๆ ไม่วนกลับมาใช้

## เกณฑ์แนะนำตามมาตรฐานอุตสาหกรรมรถยนต์ + ปรับบริบทไทย

| ตัวชี้วัด | Hot | Warm | Cold | OEM/Online Lead |
|---|---|---|---|---|
| **ตอบสนองครั้งแรก** | ≤ 1 ชม. | ≤ 4 ชม. | ≤ 24 ชม. | **≤ 15–30 นาที** |
| **ความถี่ติดตามขั้นต่ำ** | ทุก 2–3 วัน | ทุก 7 วัน | ทุก 30 วัน | ตาม temperature |
| **Idle → nudge เซลส์** | 4 วัน | 10 วัน | 40 วัน | 1 วัน |
| **Idle → แจ้ง ผจก.** | 7 วัน | 14 วัน | 50 วัน | 2 วัน |
| **Idle → ริบเข้า pool** | 10 วัน | 21 วัน | ไม่ริบ → ย้ายเข้า nurture | 5 วัน |

เหตุผลเบื้องหลังตัวเลข:
- **Online/OEM lead ต้องเร็วระดับนาที** — งานวิจัยอุตสาหกรรมชี้ตรงกันว่าอัตราติดต่อสำเร็จร่วงแรงมากหลังชั่วโมงแรก และแบรนด์แม่มักวัด dealer response time ด้วย
- **รอบตัดสินใจซื้อรถใหม่ในไทยเฉลี่ย 1–3 เดือน** — ดังนั้น lead ไม่ควร "ตาย" ที่ 60 วัน แต่ควรเปลี่ยนโหมด: active (เซลส์ตาม) → **nurture** (การตลาดเลี้ยงด้วย broadcast/แคมเปญอัตโนมัติ ไม่กินเวลาเซลส์) นาน 6–12 เดือน แล้วค่อย archive
- **การริบที่ 10 วันสำหรับ hot ฟังดูโหด แต่มีขั้นเตือน 2 ชั้นก่อนเสมอ** (nudge วันที่ 4, ผจก.รับรู้วันที่ 7) — เซลส์ที่ตั้งใจทำงานจะไม่โดนริบเลย
- ทุกตัวเลขอยู่ใน `fun_sla_rule` — เดือนแรกตั้งหลวมกว่านี้แล้วค่อยขันขึ้นเมื่อทีมชินได้

## Playbook ของ ผจก. เมื่อการติดตามล้มเหลว (บังคับใช้ด้วยระบบ)

```
Day 0   นัด/กำหนดติดตามถึงกำหนด
Day +N1 ระบบ nudge เซลส์ (LINE Flex — Ch.Lead FUN พร้อม draft ข้อความให้เลย)
Day +N2 ระบบแจ้ง ผจก. → ผจก.เลือกใน LINE ได้ 3 ปุ่ม:
         [เตือนอีกครั้ง] [ย้ายให้เซลส์อื่น] [ยกเว้น (ต้องใส่เหตุผล)]
Day +N3 ไม่มี action ใดๆ → ริบอัตโนมัติเข้า fun_lead_pool
         → hot lead ใน pool แจกต่อภายใน 24 ชม. (ผจก.กด claim ให้เซลส์ หรือ round-robin)
         → บันทึกใน assignment_history เสมอ = โปร่งใส ตรวจย้อนได้
ผลต่อ KPI: จำนวน forfeit ของเซลส์แต่ละคน ขึ้น dashboard ผจก. และคิดในประเมินผล
```

หลักการ (principle of work) ที่ระบบบังคับให้เกิดเอง:
1. **ไม่มี lead ตกหล่นเงียบๆ** — ทุกการหลุด SLA มี event + มีคนรับผิดชอบ
2. **ริบไม่ใช่การลงโทษ แต่คือการช่วยลูกค้า** — ลูกค้าได้คนดูแลใหม่เร็ว
3. **ยกเว้นได้ แต่ต้องมีลายเซ็น** — ผจก. exempt ได้ทุกเคส แต่บันทึกถาวร
4. **ข้อมูลไม่หาย แค่เปลี่ยนโหมด** — active → nurture → archive ไม่มี delete

---

# ส่วนที่ 5 — ปลายทาง Funnel: จอง → DMS → ส่งมอบ → วนลูป

## 5.1 เมื่อ lead ถึง stage `booking`

ขั้นตอนที่ระบบทำให้:
1. เซลส์กด "ลูกค้าจองแล้ว" ใน LINE/หน้าเว็บ → สร้าง `fun_booking` + ระบบดึงข้อมูลที่มีครบแล้วมา generate **Booking Package**: ชื่อ-ที่อยู่เต็ม (decrypt เลขบัตร ณ จุดนี้จุดเดียว), รุ่น/สี/ราคา/ส่วนลดจาก quotation ล่าสุด, ไฟแนนซ์, เทิร์น, มัดจำ
2. Booking Package แสดงเป็นหน้าสรุปพร้อม copy — **เซลส์/ธุรการคีย์เข้า DMS เดิมตามปกติ** (เพราะ DMS ไม่มี API และเป็นระบบทางการที่ผูกบัญชี/สต็อก) แต่ไม่ต้องถามลูกค้าซ้ำ ไม่ต้องพิมพ์ใหม่ทั้งหมด
3. `dms_sync_status = 'pending_entry'`

## 5.2 Reconcile Loop (หัวใจของการเชื่อมสองระบบโดยไม่แตะ DMS)

```
ทุกคืน 22:00 — n8n job:
  1. อ่านรายการใบจองใหม่จาก DMS
     ทางเลือก A (แนะนำ): อ่าน MariaDB ของ DMS โดยตรงแบบ read-only user
     ทางเลือก B (fallback): scrape หน้ารายการจองด้วย pattern เดียวกับ skill redplate
  2. จับคู่กับ fun_booking ที่ pending_entry
     คีย์จับคู่: เบอร์โทรลูกค้า (last4+hash) + รุ่นรถ + ช่วงวันที่ ±3 วัน
  3. เจอคู่ → dms_booking_ref = เลขใบจอง DMS, status = 'matched'
     ยอดไม่ตรง → 'mismatch' + แจ้ง ผจก. (กันคีย์ผิด/ส่วนลดเกินสิทธิ์)
     เกิน 3 วันยังไม่เจอ → แจ้งเตือน "จองใน Prospect แต่ยังไม่เข้า DMS"
  4. บันทึกผลใน fun_dms_sync_log
```

> ข้อดีของ pattern นี้: DMS เดิมยังเป็น **source of truth ทางบัญชี** เหมือนเดิม 100% — Prospect 2.0 เป็น source of truth ของ**กระบวนการขาย** ไม่มีการเขียนข้ามระบบ = ไม่มีความเสี่ยงข้อมูลบัญชีเพี้ยน และตรวจจับความไม่ตรงกันได้ทุกคืนแทนที่จะไปเจอตอนปิดงบ

## 5.3 หลังจอง → ส่งมอบ → วนกลับเป็นลูกค้าเก่า

- Reconcile job ติดตามสถานะใน DMS ต่อ: จอง → ทำสัญญา → รับรถเข้า → **ส่งมอบ** → อัปเดต `fun_lead.stage` อัตโนมัติ เซลส์ไม่ต้องคีย์ซ้ำ
- ณ วันส่งมอบ: lead ปิดเป็น `won`, person ผูกกับรถ (vehicle ownership — เฟสถัดไปเพิ่ม `fun_vehicle_ownership`)
- **จุดที่มูลค่าระยะยาวเกิด:** person คนนี้ไหลเข้าวงจร service/ประกัน/ทะเบียน (เมนู CRM ที่ DMS มีอยู่แล้ว) และอีก 4–5 ปี ระบบสร้าง lead ใหม่ channel = `service` ให้อัตโนมัติเมื่อถึงรอบเปลี่ยนรถ — **ลูกค้าเก่าคือแหล่ง lead ที่ถูกที่สุด** และตอนนี้ยังไม่มีใครทำแบบเป็นระบบ

---

# ส่วนที่ 6 — ได้อะไรออกมา (สิ่งที่ schema นี้ปลดล็อค)

| ผลลัพธ์ | ได้จากตาราง | ใครใช้ |
|---|---|---|
| Funnel conversion ทุกสาขา/แบรนด์/เซลส์/รุ่น real-time | lead + stage_history | ผจก./ผู้บริหาร |
| Cost per lead / cost per sale ต่อแคมเปญ | campaign + lead + booking | การตลาด |
| เวลาตอบสนองครั้งแรกเฉลี่ย + % หลุด SLA | lead.first_response_at + sla_event | ผจก. |
| จุดตันของ funnel (time-in-stage) | stage_history | ผู้บริหาร |
| เหตุผลแพ้ แยกคู่แข่ง/ไฟแนนซ์/ราคา | lost_reason + finance_application | ผู้บริหาร/แบรนด์ |
| Leaderboard เซลส์ + forfeit count | kpi_daily + assignment_history | ผจก. |
| financier ไหนอนุมัติง่ายตาม profile | finance_application | เซลส์ (AI แนะนำ) |
| ประสิทธิผล nudge ของ AI | nudge_log | คุณ Nutt (ปรับ prompt) |
| no-show rate ต่อช่องทาง | appointment | ผจก. |
| ลูกค้าเก่าครบรอบเปลี่ยนรถ → lead อัตโนมัติ | person + booking (ownership) | ทั้งองค์กร |

# ส่วนที่ 7 — ลำดับการสร้าง (Build Order)

1. **Dimension ก่อน**: branch, brand, user, model, source_channel (1 วัน — ข้อมูลมีอยู่แล้ว)
2. **Customer master + dedup**: person, person_identifier, person_consent + import จาก DMS (hash เลขบัตร/เบอร์ → จับซ้ำรอบแรก)
3. **Lead core**: lead, activity, stage_history, appointment + trigger อัปเดต last_activity
4. **Legacy import**: ดึง pros_* จาก DMS → map เข้า lead (dms_pros_id ผูกไว้)
5. **SLA engine**: sla_rule (ค่าเริ่มต้นจากตารางส่วนที่ 4), sla_event + n8n cron ตรวจทุกชั่วโมง
6. **Governance**: assignment_history, lead_pool + LINE flow ของ ผจก.
7. **Commercial**: quotation, finance_application, tradein_appraisal
8. **Booking + reconcile**: booking, dms_sync_log + n8n nightly job
9. **Analytics**: kpi_daily + dashboard

---
*เอกสารนี้พร้อมใช้เป็น handoff ให้ Claude Code — แนะนำให้ agent สำรวจ `ch_erawan_schema` และ pattern จากโปรเจกต์ CATS/Nong Count ก่อน CREATE TABLE จริง*
