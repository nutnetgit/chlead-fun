# Ch.Lead FUN (ชื่อทำงานเดิม: Prospect 2.0) — Claude Code Handoff

> **โปรเจกต์:** รื้อสร้างโมดูล Prospect ของ DMS เดิม (SPS) ใหม่ทั้งหมด สำหรับฝ่ายขาย Ch. Erawan Group
> **ชื่อทางการของระบบใหม่ = "Ch.Lead FUN"** (ADR-012b) · เอกสาร/mockup เก่าใช้ชื่อทำงาน "Prospect 2.0" — ระบบเดียวกัน
> **วันที่ handoff:** 2026-07-06 (ปรับหลัง grilling session #1)
> **ที่มา:** ออกแบบเต็มใน Claude.ai — ไฟล์นี้คือ single source of truth ของงานออกแบบนั้น
> **เจ้าของ:** Nutt (GenAI architect, Ch. Erawan Group)
> **ไฟล์ประกอบ (ต้องอ่านทั้งหมด):** `prospect2-schema-design.md` (schema เต็ม) · **`prospect2-adr-log.md` (ADR-001…014 — การตัดสินใจที่ grill แล้ว มีอำนาจเหนือเนื้อหาเก่าในไฟล์นี้ถ้าขัดกัน)** · `prospect2-glossary.md` · mockup 4 หน้าจอ

## ⚡ การตัดสินใจสำคัญจาก grilling (สรุป — รายละเอียดใน ADR log)
1. **ADR-010 (🟡 รอ mandate):** Booking Handoff = ประตูบังคับเข้า SPS · break-glass มีได้แต่มองเห็นเสมอ+ตามเก็บใน 24 ชม. · Handoff generate อัตโนมัติจากข้อมูลระหว่างทาง
2. **ADR-011:** temperature ขัดกับ ai_score เกิน 1 ระดับ → บังคับ Warm + badge มองเห็นทุกจอ + `sla_override` ต้องมีเหตุผล + ผจก.เห็น aggregate — เพิ่ม `fun_lead.temperature_conflict`, `activity_type='sla_override'`
3. **ADR-012: Fresh start** — import เฉพาะ `customer`→`fun_person` (เพื่อ dedup) · **ไม่ import lead/ประวัติเก่า** · person เก่าไม่มี consent → automation ไม่แตะจนกว่ามี consent ใหม่ · **ตัด legacy lead import ออกจาก §4 และ build order เดิมขั้น 4**
4. **ADR-013:** parallel run 1–2 เดือน · SPS เดิมใช้ได้เต็มแต่มี **n8n check รายวัน**นับ lead ใหม่ที่หลุดไปสร้างในระบบเก่า → แจ้งทันที · cutover gate วัดอัตโนมัติ (≥95% / 2 สัปดาห์ + ไม่มี breach ค้าง + ผจก.ยืนยัน)
5. **ADR-014: MVP = pilot มาสด้า สนญ. 1 เดือน** · MVP scope วันแรก: person+lead+activity, SLA engine, LINE digest+quick-log, Booking Handoff, dashboard ขั้นต่ำ · ยังไม่ทำ: FB adapter, quotation/finance/tradein เต็ม, analytics ลึก

---

## 0. งานแรกก่อนเขียนโค้ด — สำรวจของเดิม

ก่อน CREATE TABLE หรือเขียน workflow ใดๆ ให้สำรวจ 2 อย่างนี้ก่อน แล้วทำรายงานสั้นๆ:

### 0.1 สำรวจโปรเจกต์ CATS (หา reusable patterns)
หา path ของโปรเจกต์ **CATS** บนเครื่อง (ถ้าไม่เจอให้ถาม user) แล้วรายงาน:
1. **LINE push pattern** — ส่ง LINE group / Flex Message builder / จัดการ group ID อย่างไร
2. **Settings UI** — หน้าจอตั้งค่า, tech stack (framework, DB client, deployment)
3. **Config storage** — เก็บ config ที่ไหน (DB table / env / JSON)
4. **LINE Login / identity** — ยืนยันตัวตนพนักงานอย่างไร (ถ้ามี)

**ใช้ stack เดียวกับ CATS** เว้นแต่มีเหตุผลชัดเจนที่จะไม่ใช้ เพื่อให้ทั้ง ecosystem ของ Nutt สอดคล้องกัน

### 0.2 อ่านซอร์สโมดูล Prospect เดิม (ไฟล์แนบ `pp/`)
โครงตารางเดิมของ SPS ถูกยืนยันจากซอร์สแล้ว (ดูหัวข้อ 4). ใช้เป็นต้นทางของ **การ import ข้อมูลเก่าครั้งเดียว** เท่านั้น

### 0.3 สำรวจดีไซน์ Ch.Lead FUN (รวมเข้าโปรเจกต์นี้)
Prospect 2.0 = **superset ของ Ch.Lead FUN** — Ch.Lead FUN คือ "ช่องทางรับ lead จาก FB Lead Ads" หนึ่งช่องทางที่ไหลเข้า funnel เดียวกันนี้ **ยังไม่ deploy** (ค้างที่ Meta App Review) → เป็นการ **รวมดีไซน์ ไม่ใช่ย้ายข้อมูล production**

หา `ch_lead_fun_handoff.md` + n8n workflows `[FUN] WF1–WF4` (ถ้าถูกสร้างไว้) แล้ว reuse:
1. **4 workflow เดิม** — WF1 Intake (FB webhook), WF2 Nightly scoring (Gemini), WF3 Morning nudge, WF4 Response handler → กลายเป็น AI layer + SLA engine ของ Prospect 2.0
2. **Settings UI (Cloudflare Pages)** ที่เขียน config ลง MariaDB จากวันแรก → เป็นฐานของหน้า settings Prospect 2.0
3. **`fun_channel_config` + `fun_settings`** — ใช้ต่อได้ (ดู §4.2)
4. **FB System User token + `@groupid` trick + Cloudflare Access pattern** — reuse ตรงๆ

---

## 1. สรุปโปรเจกต์

Prospect 2.0 คือระบบจัดการ **lead / ลูกค้าคาดหวัง** ของฝ่ายขาย แทนที่โมดูล Prospect เดิมใน SPS โดย:

- เก็บ lead จากทุกช่องทาง (walk-in, โทร, Facebook, LINE, referral, ลูกค้าเก่า/ศูนย์บริการ, OEM lead, event, fleet)
- ติดตามลูกค้าแบบมีวินัย SLA หลายชั้น — nudge เซลส์ → แจ้ง ผจก. → ริบเข้า pool อัตโนมัติ
- AI (Gemini ตอนนี้ → Sabai อนาคต) **ให้คะแนน lead + ร่างข้อความไทย** ให้เซลส์ส่งเอง
- ทำงานได้ทั้ง **LINE และ Web App** ทั้งเซลส์และผู้จัดการ
- จบ funnel ที่ **"ลูกค้าต้องการจอง"** → generate สรุปข้อมูลส่งต่อให้การเงินกรอก SPS หลัก

### ข้อจำกัดเหล็ก (ห้ามละเมิด)
- **AI ไม่ทักลูกค้าโดยตรงเด็ดขาด** — AI ร่าง, คนส่ง เป็นกฎบริษัท
- ข้อมูลอยู่ใน `ch_erawan_schema` บน Docker MariaDB **port 3307** (Synology DS1621+)
- ตารางใหม่ใช้ prefix **`fun_`** — ห้ามแตะตารางของ Nong Count, Staff Bot, หรือโปรเจกต์อื่น
- เบอร์โทร/เลขบัตร ต้อง **mask ก่อนส่งเข้า AI API ภายนอก** (PDPA) — เลขบัตรเก็บเป็น hash + encrypted เท่านั้น
- ชื่อ AI agent ภายในคือ **Sabai** — ถ้าอ้างถึงให้ใช้ชื่อนี้เท่านั้น

---

## 2. ขอบเขต (Scope) — สำคัญมาก อ่านให้ชัด

### อยู่ในขอบเขต ✅
```
lead → คัดกรอง → มอบหมายเซลส์ → วงจรติดตาม (SLA) →
  milestone (ทดลองขับ/เสนอราคา/เช็คไฟแนนซ์/ตีเทิร์น) →
  ลูกค้าต้องการจอง → generate "Booking Handoff" ส่งต่อการเงิน  ◄── จบตรงนี้
```

### อยู่นอกขอบเขต (เฟสนี้) ❌
- **ไม่แตะ SPS หลัก** (จอง, stock, สั่งแต่งรถ, ป้ายแดง, รับเงินจอง/ดาวน์/ค่ารถ) — เป็นระบบการเงิน source of truth
- **ไม่ทำ reconcile การเงิน** กลับมา (ดาวน์/ป้ายแดง/ส่งมอบ) — จบก่อนถึงตรงนั้น
- **ไม่อ่าน/เขียน DB ของ SPS หลัก** — Prospect 2.0 ทำงานอิสระ 100%
- ระบบประกันภัย + ทะเบียน — คนละระบบ ไม่เกี่ยว

> **ผลลัพธ์:** ไม่ต้องรอ/ไม่ต้องมี MariaDB access ของ SPS หลัก การเข้าถึง DB เดิมเหลือแค่ **import lead เก่าครั้งเดียวตอนเริ่ม**

### เผื่ออนาคต (ออกแบบให้ต่อยอดได้ แต่ห้าม over-engineer ตอนนี้)
Nutt วางแผนทำระบบที่เหลือทั้งหมดในอนาคต ดังนั้น:
- แยก `fun_person` (คน) ออกจาก `fun_lead` (โอกาสขาย) ตั้งแต่แรก → ระบบ service/ประกัน/ทะเบียน วันหน้าเชื่อมลูกค้าเดิมได้ทันที
- `fun_booking_handoff` ออกแบบให้อัปเกรดเป็น full SPS integration ได้ โดยไม่ต้องแก้ของเดิม

---

## 3. Schema — ปรับตาม scope ใหม่

ใช้ schema เต็มใน `prospect2-schema-design.md` เป็นหลัก **โดยปรับกลุ่ม F ตามนี้:**

### กลุ่ม F เดิม → ปรับเป็น "Booking Handoff" (ลดรูป)
| เดิมในไฟล์ schema | สถานะในเฟสนี้ |
|---|---|
| `fun_booking` + `dms_sync_status` | ✅ เก็บไว้ แต่ตัด field reconcile ออก |
| `fun_dms_sync_log` | ❌ **ตัดออกจากเฟสนี้** |
| reconcile job ทุกคืน | ❌ ตัดออก |

### ตารางใหม่แทนที่: `fun_booking_handoff`
```sql
handoff_id          BIGINT PK AUTO_INCREMENT
lead_id             FK→fun_lead UNIQUE
person_id           FK→fun_person
handoff_no          VARCHAR(30)          -- เลขอ้างอิงภายใน Prospect 2.0
-- snapshot ข้อมูลที่การเงินต้องใช้กรอก SPS หลัก (freeze ณ วันจอง)
customer_fullname   VARCHAR(200)
customer_addr_full  TEXT
citizen_id_enc      VARBINARY(255)       -- decrypt แสดงเฉพาะบนหน้า handoff
model, variant, color VARCHAR
agreed_price        DECIMAL(12,2)
discount            DECIMAL(12,2)
accessories_note    TEXT                 -- ของแถมที่ตกลง
tradein_note        TEXT NULL
finance_note        TEXT NULL            -- ธนาคาร/ดาวน์/งวด ที่คุยไว้
deposit_expected    DECIMAL(12,2) NULL
status              ENUM('ready','sent_to_finance','completed_in_sps','cancelled')
generated_by        FK→fun_user
generated_at        DATETIME
completed_at        DATETIME NULL         -- การเงินยืนยันกรอก SPS แล้ว (กดเองในเฟสนี้)
```
> funnel stage สุดท้ายของ Prospect 2.0 = **`booking`** (พร้อมส่งต่อการเงิน) ไม่ใช่ `won/delivered`

### ตารางที่เหลือ (กลุ่ม A–E, G–I) — ใช้ตามไฟล์ schema เต็มไม่เปลี่ยน
A: person, person_identifier, person_consent · B: source_channel, campaign ·
C: lead, lead_stage_history, lost_reason · D: activity, appointment ·
E: quotation, finance_application, tradein_appraisal ·
G: sla_rule, sla_event, assignment_history, lead_pool ·
H: nudge_log · I: dimension tables (branch, brand, user, team, model, duty_roster, kpi_daily ...)

---

## 4. โครงตารางเดิม SPS (ยืนยันจากซอร์ส) — ใช้สำหรับ import ครั้งเดียว

| ตารางเดิม | → ตารางใหม่ | หมายเหตุ transform |
|---|---|---|
| `customer` | `fun_person` + `fun_person_identifier` + `fun_person_consent` | แยกเบอร์/LINE/email เป็น identifier rows; เลขบัตร `cus_card` → hash + enc; สร้าง consent default flag ให้ re-confirm |
| `prospectcontact` | `fun_lead` | `pros_walkevent`→`channel_id` (ดู 4.1), `pros_active` inactive→`lost`/`nurture` (ตัดตามวันที่), `pros_id`→`dms_pros_id` |
| `prospect_follow` | `fun_activity` | `prosfo_status`→ split เป็น `activity_type`+`outcome`; `prosfo_nextdate`→`next_action_at` |
| `log_pros_inactive` | `fun_sla_event` | เป็น historical `idle_forfeit` events |
| `stock_brand/model/color` | `fun_brand`/`fun_model` | direct |
| `branch` | `fun_branch` | **ยืนยันจำนวนสาขา** — login เดิมโชว์ 9 (Mazda สนญ./ศาลายา, Ford อ้อมใหญ่, Mitsu ลำพยา, Autopro นครปฐม/ศาลายา, GWM นครปฐม, Deepal ศาลายา, KIA นครปฐม) |
| `user`/`user_branch` | `fun_user`/`fun_team` | map role |
| `prospect_typecontact` | seed `fun_source_channel` | ดู 4.1 |

### 4.1 Channel mapping (`pros_walkevent` → `fun_source_channel`)
`prospect_typecontact` มี field: `prosty_id, prosty_name, prosty_db_name, prosty_type(1|2), prosty_active`
`prosty_type=1` = walk/event, `type=2` = contact-based

| ค่าเดิม | category | channel |
|---|---|---|
| walk in โชว์รูม | walkin | Walk-in showroom |
| ออกบูธ/อีเว้นท์ | event | Event / booth |
| ลูกค้าเก่า/ศูนย์บริการ | service | Existing customer |
| แนะนำ | referral | Referral |
| โทรเข้า / โทรออก | phone | Inbound / Outbound call |
| Facebook | online_owned | Facebook Page |
| Line@ | online_owned | LINE OA |
| Lead (แบรนด์ส่ง) | oem | OEM lead |
| `''` (ว่าง) | unknown | Legacy incomplete |

> **ต้องยืนยันก่อน import:** `SELECT DISTINCT prosty_db_name, prosty_name, prosty_type FROM prospect_typecontact WHERE prosty_active=1` — ตารางนี้ครอบคลุมค่าที่เห็นแล้ว แต่แต่ละสาขาอาจเพิ่ม custom row

### ⚠️ ประเด็นความปลอดภัยของโค้ดเดิม (ไม่ยกมา — สร้างใหม่ให้ปลอดภัย)
โค้ดเดิมมี: SQL injection (`mysql_*` + `$_REQUEST` ตรงๆ 142 จุด), password MD5, เลขบัตร plain text, มี `backdoor` login — โค้ดใหม่ต้องใช้ prepared statements, hash password มาตรฐาน, encrypt เลขบัตร, ไม่มี backdoor

### 4.2 Ch.Lead FUN — รวมดีไซน์ (ไม่ใช่ย้ายข้อมูล)
Ch.Lead FUN ยังไม่ deploy → **ไม่มี data migration** เป็นการ reconcile ดีไซน์ให้ตารางไม่ซ้อนกัน

| ตารางเดิม Ch.Lead FUN | การตัดสินใจ | เหตุผล |
|---|---|---|
| `fun_channel_config` | ✅ **ใช้ต่อตรงๆ** เป็น config ของ FB intake adapter | routing FB page→brand→branch→LINE group ยังจำเป็นตอนต่อ FB |
| `fun_settings` | ✅ **ใช้ต่อ** — เก็บ prompt scoring/drafting + token health | ไม่ซ้อนกับ schema ใหม่ |
| `fun_leads` (พหูพจน์) | ❌ **ยุบทิ้ง → แทนด้วย `fun_person` + `fun_lead` + `fun_person_identifier` + `fun_person_consent`** | schema ใหม่แยก "คน" ออกจาก "โอกาสขาย"; **อย่าสร้าง `fun_leads`** |

**⚠️ naming เตือน:** Ch.Lead FUN ใช้ `fun_leads` (พหูพจน์) แต่ Prospect 2.0 ใช้ **`fun_lead` (เอกพจน์)** — ยึด `fun_lead` เป็นมาตรฐานเดียว

**field ของ `fun_leads` เดิม map เข้า schema ใหม่:**
- `source` → `fun_lead.channel_id` (ผ่าน `fun_source_channel`)
- `fb_leadgen_id`, `fb_page_id` → `fun_lead` (เพิ่ม field `fb_leadgen_id`, `fb_page_id` สำหรับ dedup/audit ของ FB adapter)
- `customer_name`, `phone`, `line_user_id` → `fun_person` + `fun_person_identifier`
- `consent_flag`, `consent_date` → `fun_person_consent`
- `score`, `score_reason` → `fun_lead.temperature` + `ai_score` + `ai_score_reason`
- `status` (new/assigned/.../won/lost/dormant) → `fun_lead.stage` + `status` (map dormant→nurture)
- `next_followup_date` → `fun_lead.next_action_at`
- **dedup lesson (จาก Nong Count):** repeat inquiry ต้องไม่ fail — ใช้ `INSERT ... ON DUPLICATE KEY UPDATE` + log reopen activity (เก็บเป็น `fun_activity`)

**4 workflow เดิม → บทบาทใหม่:**
| Ch.Lead FUN workflow | → ใน Prospect 2.0 |
|---|---|
| WF1 Intake (FB webhook) | **FB Lead Ads intake adapter** (build ทีหลัง หลัง Meta ผ่าน — §7 ขั้น 11) |
| WF2 Nightly scoring (Gemini) | AI layer — ป้อน `ai_score` (§7 ขั้น 7) |
| WF3 Morning nudge | SLA engine + digest เช้า (§7 ขั้น 5,9) |
| WF4 Response handler | เขียน `fun_activity` (§7 ขั้น 3) |

---

## 5. กติกา SLA (seed ลง `fun_sla_rule`)

| ตัวชี้วัด | Hot | Warm | Cold | OEM/Online |
|---|---|---|---|---|
| ตอบครั้งแรก | ≤1 ชม. | ≤4 ชม. | ≤24 ชม. | ≤15–30 นาที |
| ความถี่ติดตาม | ทุก 2–3 วัน | ทุก 7 วัน | ทุก 30 วัน | ตาม temp |
| idle→nudge เซลส์ | 4 วัน | 10 วัน | 40 วัน | 1 วัน |
| idle→แจ้ง ผจก. | 7 วัน | 14 วัน | 50 วัน | 2 วัน |
| idle→ริบเข้า pool | 10 วัน | 21 วัน | ไม่ริบ→nurture | 5 วัน |

- **แทนกฎ 60 วันเดิม** (เดิมทำงานตอน login เท่านั้น + ไม่มีเตือนก่อน + ริบแล้วหาย)
- SLA engine ต้องรันด้วย **n8n cron ทุกชั่วโมง** ไม่ใช่ตอนมีคน login
- เดือนแรกตั้งค่าหลวมกว่านี้ได้ (ปรับใน `fun_sla_rule` ไม่ต้องแก้โค้ด) — **ยืนยันกับ Nutt ว่าจะเริ่มหลวมหรือใช้ค่านี้เลย**

### Playbook เมื่อติดตามล้มเหลว
```
idle→nudge : ระบบส่ง Flex ให้เซลส์ (พร้อม draft ข้อความ)
idle→escalate : แจ้ง ผจก. LINE + Dashboard → 3 ปุ่ม [เตือนอีก][ย้ายเซลส์][ยกเว้น+เหตุผล]
idle→forfeit : ริบเข้า fun_lead_pool อัตโนมัติ → hot ใน pool แจกต่อใน 24 ชม.
ทุกการเปลี่ยนมือ → fun_assignment_history (ตรวจย้อนได้) · forfeit count → KPI เซลส์
```

---

## 6. Interface — 4 บทบาท × 2 ช่องทาง

ทุกช่องทางเขียนกลับ **core DB เดียวกัน** → sync อัตโนมัติ ทุกจอเห็นตรงกัน

| | LINE (เร็ว/แจ้งเตือน/สั่งด่วน) | Web App (ดูลึก/กรอกละเอียด/วิเคราะห์) |
|---|---|---|
| **เซลส์** | digest เช้า, Flex card ต่อ lead + draft AI, ปุ่ม quick-log (ติดต่อแล้ว/นัดใหม่/ปิดได้), voice-to-text | ไปป์ไลน์ตัวเอง, รายละเอียด lead เต็ม + timeline, กรอกจอง (Booking Handoff), เสนอราคา |
| **ผจก.** | สรุปทีมเช้า, alert หลุด SLA, ปุ่มสั่งด่วน (ย้าย/เตือน/ยกเว้น) | Dashboard เต็ม, drill-down รายสาขา/เซลส์, reassign, lost-reason analytics |

**Design reference (ล็อกแล้ว):** ดู mockup teal — IBM Plex Sans Thai, warm off-white `#F7F6F3`, accent teal `#0F7A66`, hairline border 0.5px, weight สูงสุด 600, temperature semantics (hot=แดงอิฐ `#B7472E`, warm=อำพัน `#9C6B15`). โทน minimal นุ่มตา ตระกูลเดียวกับ CATS แต่ accent teal เป็นเอกลักษณ์ฝ่ายขาย

**AI draft flow:** trigger → mask PII → Gemini ร่างข้อความไทย → เก็บ `fun_nudge_log` → push Flex ให้เซลส์ → เซลส์กด "คัดลอกแล้วส่งเอง" → track `sales_action`

---

## 7. ลำดับการสร้าง (Build Order)

1. **Dimension** — branch, brand, user, team, model, source_channel (ข้อมูลมีแล้ว) · ยืนยัน 9 สาขา + channel values
2. **Customer master + dedup** — person, person_identifier, person_consent + import `customer` (hash เลขบัตร/เบอร์ จับซ้ำ)
3. **Lead core** — lead, activity, stage_history, appointment + trigger อัปเดต `last_activity_at`/`next_action_at`
4. **Legacy import** — `prospectcontact`→lead, `prospect_follow`→activity (ผูก `dms_pros_id`)
5. **SLA engine** — sla_rule (seed จาก §5), sla_event + n8n cron รายชั่วโมง
6. **Governance** — assignment_history, lead_pool + LINE flow ผจก. (3 ปุ่ม)
7. **AI layer** — nudge_log + Gemini draft workflow (mask PII ก่อน) + Flex push
8. **Commercial + Handoff** — quotation, finance_application, tradein_appraisal, booking_handoff
9. **Interface** — Web App (เซลส์ + ผจก. dashboard), LINE (digest + quick-log) · reuse Settings UI ของ Ch.Lead FUN
10. **Analytics** — kpi_daily pre-aggregate + lost-reason report
11. **FB Lead Ads intake adapter** (แยก · build หลัง Meta App Review ผ่าน · **ไม่บล็อกขั้น 1–10**) — reuse WF1 + `fun_channel_config` + FB System User token จาก Ch.Lead FUN

> **สำคัญ:** แกนกลาง (ขั้น 1–10) ไม่ผูกกับ Meta review — lead ส่วนใหญ่มาจาก walk-in/โทร/referral เดินหน้าได้ทันที · FB เป็น adapter เสียบทีหลัง

---

## 8. ยืนยันกับ Nutt ก่อนเริ่ม (open items)
1. จำนวนสาขาจริง (9 ตาม login เดิม หรือ 7) + channel values (`prospect_typecontact`)
2. SLA เดือนแรก — ใช้ค่า §5 เลย หรือเริ่มหลวมกว่า
3. Booking Handoff — การเงินกดยืนยัน "กรอก SPS แล้ว" ในระบบ (manual เฟสนี้) โอเคไหม
4. path ของ CATS + Ch.Lead FUN (`ch_lead_fun_handoff.md`, n8n `[FUN]` workflows) สำหรับสำรวจ pattern
5. ยืนยันว่า Ch.Lead FUN ยังไม่มี data ใน production (ถ้ามี ต้องเพิ่มขั้น migrate `fun_leads`→`fun_person`+`fun_lead`)

---
*จบ handoff — เริ่มจาก §0 (สำรวจ CATS) แล้วไล่ตาม build order §7*
