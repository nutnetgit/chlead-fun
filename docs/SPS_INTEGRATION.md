# Ch.Lead FUN ↔ SPS — คู่มือเชื่อมต่อสำหรับทีมพัฒนา DMS (SPS)

ฉบับ 2026-09-10 · เจ้าของระบบ: Nutt (ช.เอราวัณ) · โค้ดอ้างอิง: `src/lib/menuAccess.ts`, `src/lib/sso.ts`, `src/lib/dms/reader.ts`, `src/lib/jobs/dmsCatalogSync.ts`, `src/app/api/sso/*`, `src/app/api/permissions/*`

Ch.Lead FUN (`https://fun.ch-erawan.com`) คือระบบติดตาม Lead ก่อนการจอง แทนโมดูล Prospect เดิมใน SPS เอกสารนี้อธิบาย 3 จุดเชื่อมที่ฝั่ง SPS ต้องทำ/รับรู้:

1. **สิทธิ์ผู้ใช้** — Lead FUN เก็บสิทธิ์รูปแบบเดียวกับ `user_menu` ของ SPS (รายเมนู × 6 ธง) และมี API export/import
2. **ตัวตนผู้ใช้ร่วม** — จับคู่บัญชีด้วย LINE userId (channel เดียวกัน) หรือ `user.u_id`
3. **SSO 2 ทิศทาง** — ticket ใช้ครั้งเดียว อายุ 60 วินาที + endpoint ตรวจสอบ (รูปแบบเดียวกับที่ CPT/ระบบประกันใช้)
4. **ซิงก์รุ่นรถและสี** — Lead FUN อ่านแคตตาล็อกของ SPS แบบอ่านอย่างเดียว ไม่ต้องแก้โค้ด SPS

ทุก endpoint ที่ SPS เรียก เป็น **server-to-server เท่านั้น** (PHP → Lead FUN) ห้ามเรียกจาก browser และห้ามใส่ token ใน JavaScript

---

## 0. เริ่มที่นี่ — งานที่ต้องทำเพื่อเปิดการเชื่อมต่อ

ฝั่ง Lead FUN เขียนเสร็จและขึ้น production แล้วทั้งหมด สิ่งที่เหลือคือการตั้งค่าและงานฝั่ง SPS แบ่งเป็น 3 กลุ่มที่ **ทำแยกกันได้ ไม่ต้องรอกัน**

### กลุ่ม A — ซิงก์รุ่นรถและสี (ไม่ต้องแก้โค้ด SPS เลย)

| # | งาน | ผู้รับผิดชอบ | อ้างอิง |
|---|---|---|---|
| A1 | สร้างบัญชี MySQL บน `adam_prod` ที่มีสิทธิ์ `SELECT` เฉพาะ 4 ตาราง | IT / DBA | §5.1 |
| A2 | เปิดเส้นทางจากเครื่องที่รัน Lead FUN (NAS ภายใน `192.168.0.10`) ไปยัง `<dms-host>:3306` | IT / เครือข่าย | §7.3 |
| A3 | ใส่ `DMS_MYSQL_URL` ใน `.env` ของ Lead FUN แล้ว restart | Nutt | §7.1 |
| A4 | กรอกรหัสยี่ห้อของ SPS (`stock_brand.sto_br_id`) ให้ครบทุกยี่ห้อ | Nutt | §5.2 |
| A5 | กดปุ่ม "ซิงก์ตอนนี้" แล้วตรวจผลรอบแรก | Nutt | §5.3 |

### กลุ่ม B — ตัวตนผู้ใช้และสิทธิ์

| # | งาน | ผู้รับผิดชอบ | อ้างอิง |
|---|---|---|---|
| B1 | ส่งรายชื่อผู้ใช้ `u_id`, `u_user`, `u_name`, `line_userid` ของเซลส์/ผจก. ที่จะใช้ Lead FUN | ทีม SPS | §1 |
| B2 | กรอก `dms_user_id` ให้ผู้ใช้ทุกคน (ทีละคนที่หน้าผู้ใช้ หรือ import) | Nutt | §2.3 |
| B3 | ตกลงว่าจะซิงก์สิทธิ์สองทางหรือไม่ ถ้าซิงก์ให้ใช้ export/import | ทีม SPS + Nutt | §2.3 |

### กลุ่ม C — SSO 2 ทิศทาง (ต้องเขียนโค้ดฝั่ง SPS)

| # | งาน | ผู้รับผิดชอบ | อ้างอิง |
|---|---|---|---|
| C1 | สร้าง `SSO_API_TOKEN` แล้วส่งให้ทีม SPS ทางช่องทางปลอดภัย | Nutt | §7.1 |
| C2 | เขียน `sso_land.php` — verify ticket, สร้าง session, สร้าง/ค้น `prospectcontact`, redirect ผ่าน `login.php` | ทีม SPS | §3.2, §3.3 |
| C3 | เพิ่มเมนู "Lead FUN" ใน SPS ที่เรียก `/api/sso/issue` แล้วพาไป `sso_url` | ทีม SPS | §3.4 |
| C4 | แจ้ง URL ของ `sso_land.php` และ IP ขาออกของเครื่อง SPS | ทีม SPS | §7.2 |
| C5 | ใส่ `SPS_SSO_LANDING_URL` ใน `.env` แล้ว restart — ปุ่ม "เปิดใบจองใน SPS" จะปรากฏเอง | Nutt | §7.1 |
| C6 | ทดสอบร่วมตาม checklist | ทั้งสองฝ่าย | §6 |

**ลำดับที่แนะนำ:** A ก่อน เพราะได้ผลทันทีและไม่มีความเสี่ยง · B ทำคู่ขนานได้ · C ทำท้ายสุดเพราะต้องรอโค้ดฝั่ง SPS

---

## 1. สิ่งที่ต้องเตรียมร่วมกัน

| รายการ | ใครทำ | หมายเหตุ |
|---|---|---|
| `SSO_API_TOKEN` (สตริงสุ่ม ≥ 32 ไบต์) | Nutt สร้าง แล้วส่งให้ทีม SPS ทางช่องทางปลอดภัย | ใส่ใน `.env` ของ Lead FUN และ config ของ SPS · ส่งเป็น header `X-Api-Token` ทุกครั้ง |
| `SPS_SSO_LANDING_URL` | ทีม SPS แจ้ง URL หน้า `sso_land.php` (ข้อ 3.2) | Lead FUN redirect เซลส์ไปที่นี่พร้อม `?ticket=` |
| IP ของเครื่อง SPS | ทีม SPS แจ้ง | Lead FUN จำกัด IP ต้นทางของ `/api/sso/*` ได้ที่ reverse proxy |
| LINE Login channel | ยืนยันแล้วว่า **ใช้ channel เดียวกัน** | ⇒ `line_userid` ของคนเดียวกันตรงกันทั้งสองระบบ ใช้เป็นคีย์หลักได้ |
| `user.u_id` ของแต่ละคน | ทีม SPS ส่งรายการ `u_id, username, line_userid` | Nutt กรอกลงช่อง "รหัสผู้ใช้ SPS" ใน `/settings/users` หรือ import (ข้อ 2.3) |

---

## 2. สิทธิ์ผู้ใช้ (permission model)

### 2.1 ตาราง `fun_user_menu` — เทียบ `user_menu` ของ SPS ตรงตัว

| Lead FUN | SPS | ความหมาย |
|---|---|---|
| `user_id` | `u_id` | ผู้ใช้ (map ผ่าน `fun_user.dms_user_id` ↔ `user.u_id`) |
| `menu_key` | `u_me_menu` | รหัสเมนู (ดูตาราง 2.2) |
| `can_add` | `u_me_add` | เพิ่มรายการใหม่ |
| `can_edit` | `u_me_edit` | แก้ไข |
| `can_cancel` | `u_me_cancel` | ยกเลิก (ริบ Lead / ทำเครื่องหมายเสีย / ยกเลิก event) |
| `can_del` | `u_me_del` | ลบทิ้ง |
| `can_report` | `u_me_report` | ดึงรายงาน / export |
| `can_viewall` | `u_me_viewall` | เห็นทุกรายการ (ไม่ติ๊ก = เห็นเฉพาะของตัวเอง/สาขาตัวเอง) |

- **แถวมี = ดูได้** ไม่มีคอลัมน์ "ดู" แยก (เหมือน SPS)
- ผู้ใช้ที่ **ไม่มีแถวเลย** = ใช้ค่าตั้งต้นตามบทบาท (`sales` / `manager` / `gm` / `admin`) — เทียบได้กับ `user_menu_department` ของ SPS
- `admin` ไม่ถูกจำกัดโดยตารางนี้

### 2.2 รหัสเมนูของ Lead FUN และรหัส SPS ที่ใกล้เคียง

| `menu_key` | เมนู | รหัส SPS ใกล้เคียง (`legacy_code`) |
|---|---|---|
| `leads` | Pipeline ของฉัน (Lead รายคน) | `pros2` เพิ่มการติดต่อ |
| `chat` | แชทลูกค้า (LINE) | `pros1` เพิ่มการติดต่อ Call In/Web In |
| `pool` | Lead Pool (Lead ไม่มีเจ้าของ) | `pros6` ลูกค้าที่ไม่มีเซลส์ติดตาม |
| `dashboard` | Dashboard ทีม | `pros4` จัดการข้อมูลหน้าแรก |
| `lead-center` | ศูนย์รวม Lead (ผจก. ย้าย/ริบ) | `pros5` เปลี่ยนเซลส์ |
| `runrate` | Run Rate เป้าเดือน | `sps15` สรุปการขาย |
| `events` | Event / บูธ | `sps20` กิจกรรม |
| `reports` | รายงาน | `sps15` สรุปการขาย |
| `settings-teams` | ตั้งค่า: ทีมขาย | `sps69` ทีมขาย |
| `settings-models` | ตั้งค่า: รุ่นรถและสี | `sps4` รุ่นรถ (+`sps3` สีรถ) |
| `settings-quotation` | ตั้งค่า: ใบเสนอราคา | `pros7` ใบราคารถ |
| `settings-conversion-rate` | ตั้งค่า: Conversion Rate | — |
| `settings-sla-rules` | ตั้งค่า: กฎ SLA | — |
| `settings-channels` | ตั้งค่า: ช่องทางรับ Lead (FB Page → LINE) | `pros3` ช่องทางการติดต่อ |
| `settings` | ตั้งค่า (ส่วนแอดมิน: ผู้ใช้ สาขา LINE OA automation log) | `sps1` ผู้ใช้งาน |

รหัส SPS ในตารางนี้คือ "ใกล้เคียง" เพื่อช่วยแปลง ไม่ใช่ความหมายเดียวกัน 100% — ถ้าฝั่ง SPS จะสร้างเมนูใหม่สำหรับ Lead FUN โดยเฉพาะ (เช่น `lf1`…`lf15`) แจ้งรหัสมา แล้วเราจะเปลี่ยน `legacy_code` ให้ตรง

### 2.3 API

**Export** (ดึงสิทธิ์ทุกคนจาก Lead FUN)
```
GET https://fun.ch-erawan.com/api/permissions/export
X-Api-Token: <SSO_API_TOKEN>
```
```json
{
  "exported_at": "2026-09-09T03:00:00.000Z",
  "menus": [{ "menu_key": "leads", "label": "Pipeline ของฉัน", "legacy_code": "pros2" }, …],
  "users": [{
    "fun_user_id": 12, "dms_user_id": 345, "line_userid": "U9f…", "username": "somchai",
    "display_name": "สมชาย ใจดี", "role": "sales", "is_active": true, "branch_code": "NPT",
    "perm_source": "explicit",
    "menus": [{ "menu_key": "leads", "legacy_code": "pros2", "add": 1, "edit": 1, "cancel": 1, "del": 0, "report": 0, "viewall": 0 }, …]
  }]
}
```

**Import** (SPS ส่งสิทธิ์มาทับ — แถวของผู้ใช้คนนั้นถูก **แทนที่ทั้งชุด**)
```
POST https://fun.ch-erawan.com/api/permissions/import
X-Api-Token: <SSO_API_TOKEN>
Content-Type: application/json
```
รับได้ 2 รูปแบบ:
```json
{ "dryRun": true,
  "rows": [
    { "u_id": 345, "u_me_menu": "pros2", "u_me_add": "1", "u_me_edit": "1", "u_me_cancel": "0", "u_me_del": "0", "u_me_report": "0", "u_me_viewall": "0" }
  ] }
```
หรือรูปแบบเดียวกับ export (`users[].menus[]` ระบุ `menu_key` หรือ `legacy_code`) · จับคู่ผู้ใช้ตามลำดับ `fun_user_id` → `dms_user_id` → `line_userid` → `username` · ตอบกลับ `{ matched, unmatched[], rowsWritten, unknownMenus[] }` · ส่ง `dryRun: true` ก่อนเสมอ

---

## 3. SSO

หลักการ: **ticket สุ่ม 32 ไบต์ ใช้ครั้งเดียว อายุ 60 วินาที** ฝั่งที่รับ ticket ต้องเอามาแลกกับฝั่งที่ออก ticket แบบ server-to-server (ไม่มี JWT ไม่ต้องใช้ไลบรารีเพิ่ม) Lead FUN เก็บเฉพาะ SHA-256 ของ ticket และ log ทุกการออก/ตรวจ/ปฏิเสธลง audit log

### 3.1 ภาพรวม

```
ขาออก (ปิดการขาย)                           ขาเข้า (สลับเมนูจาก SPS)
เซลส์กด "เปิดใบจองใน SPS" ใน Lead FUN       ผู้ใช้กดเมนู "Lead FUN" ใน SPS
   │ POST /api/sso/handoff {leadId}              │ SPS (PHP) → POST /api/sso/issue
   │ ← redirectUrl = SPS_SSO_LANDING_URL?ticket=T│ ← sso_url = https://fun…/sso?ticket=T
browser ──────────────► sso_land.php?ticket=T   browser ──────────────► /sso?ticket=T
                       │ POST /api/sso/verify {ticket}      Lead FUN ตรวจ ticket สร้าง session
                       │ ← user + lead payload              → ไปหน้า target (/leads)
                       │ สร้าง session Better Auth
                       └─► booking_form.php?click_from=leadfun&pros_id=…&u_id=…
```

### 3.2 ขาออก — SPS ต้องเขียน `sso_land.php`

1. รับ `?ticket=` จาก query string
2. เรียก verify (ภายใน 60 วินาที):
```
POST https://fun.ch-erawan.com/api/sso/verify
X-Api-Token: <SSO_API_TOKEN>
Content-Type: application/json

{ "ticket": "<ticket>" }
```
ตอบสำเร็จ (HTTP 200):
```json
{
  "ok": true,
  "issued_at": "2026-09-09T08:00:00.000Z",
  "user": {
    "fun_user_id": 12, "dms_user_id": 345, "line_userid": "U9f…", "username": "somchai",
    "display_name": "สมชาย ใจดี", "role": "sales",
    "branch_id": 3, "branch_code": "NPT", "dms_branch_id": 5, "branch_codes": ["NPT", "SLY"], "phone": "0812345678"
  },
  "lead": {
    "lead_id": 9876, "handoff_id": 41, "dms_pros_id": null, "stage": "booking",
    "brand": "Mazda", "branch_code": "NPT", "branch_name": "Mazda นครปฐม",
    "sps": { "program": "sales system", "branch_id": 5, "sto_br_id": 1, "brand_desc": "Mazda" },
    "customer": { "person_id": 555, "full_name": "นาย ทดสอบ ระบบ", "nickname": "ต้น", "phone": "0812345678", "line_userid": "Uab…", "address": "99 หมู่ 1 …" },
    "vehicle": { "model": "CX-5", "variant": "2.2 XDL", "color": "Soul Red", "payment_type": "finance", "has_tradein": false },
    "price": { "agreed_price": 1450000, "discount": null, "deposit_expected": null },
    "quote": { "quote_id": 77, "quote_no": "Q-2026-000077", "total_price": 1450000 }
  }
}
```
ตอบผิดพลาด: `{ "ok": false, "error": { "code": "…", "message": "…" } }`

| HTTP | code | ความหมาย |
|---|---|---|
| 401 | `UNAUTHORIZED` | `X-Api-Token` ผิด |
| 400 | `TICKET_INVALID` | ไม่มี ticket นี้ / รูปแบบผิด / เป็น ticket ขาเข้า |
| 410 | `TICKET_EXPIRED` | เกิน 60 วินาที |
| 410 | `TICKET_USED` | ถูกใช้ไปแล้ว (replay) |
| 410 | `USER_INACTIVE` | บัญชี Lead FUN ถูกปิด |

3. จับคู่ผู้ใช้ SPS: `user.line_userid == user.line_userid` ก่อน → ไม่เจอค่อยใช้ `dms_user_id == user.u_id` → ไม่เจอทั้งคู่ = แสดงข้อความให้ติดต่อแอดมิน (**อย่า** สร้าง user ใหม่อัตโนมัติ)
4. สร้าง session Better Auth ให้ผู้ใช้คนนั้น (ตามวิธีของ Better Auth ฝั่ง SPS — Lead FUN ไม่ยุ่งกับ session ของ SPS)
5. **สลับสาขาให้ตรงกับยี่ห้อของ Lead ก่อน แล้วค่อยเข้าใบจอง** — ดู §3.4 ด้านล่าง สรุปคือ
   - สร้าง/ค้นแถว `prospectcontact` ของ Lead นี้ โดยตั้ง `branch_id = lead.sps.branch_id` และ `sto_br_desc` ตาม `lead.sps.sto_br_id` แล้วได้ `pros_id` ของ SPS เอง
   - redirect ผ่าน `login.php` เพื่อให้ session สลับสาขา/ยี่ห้อ ไม่ใช่ยิงเข้า `booking_form.php` ตรงๆ:
     `login.php?program=sales%20system&branch=<lead.sps.branch_id>&goto_sps_booking=yes&Submit_right=จองรถ&pros_id=<pros_id>&cus_id=<cus_id>&u_id=<u_id>`
   - ข้อมูล prefill อยู่ใน payload ข้อ 2 แล้ว ไม่ต้องเรียกกลับมาอีก · `handoff_id` เก็บไว้อ้างอิงกลับได้
   - ถ้า SPS อยากบันทึกเลข prospect ของตัวเองกลับมา ให้เก็บ `lead_id` คู่กับ `pros_id` ไว้ (เฟสถัดไปจะมี endpoint รับ `dms_pros_id`)
6. log การรับ ticket ฝั่ง SPS (ใคร เมื่อไร IP ผลอะไร) — Lead FUN log ฝั่งตัวเองแล้ว

ตัวอย่าง PHP (ย่อ):
```php
<?php
$ticket = $_GET['ticket'] ?? '';
$ch = curl_init('https://fun.ch-erawan.com/api/sso/verify');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Api-Token: ' . SSO_API_TOKEN],
  CURLOPT_POSTFIELDS => json_encode(['ticket' => $ticket]),
  CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
]);
$res = json_decode(curl_exec($ch), true);
if (!($res['ok'] ?? false)) { /* แสดง error code, log, หยุด */ }
$u = $res['user'];
// 1) หา user SPS: line_userid ก่อน แล้ว u_id
// 2) สร้าง session (Better Auth)
// 3) $sps = $res['lead']['sps'];                       // branch_id/sto_br_id ของ SPS เอง
//    $prosId = upsert_prospectcontact($res['lead'], $sps); // สร้าง prospect ในสาขานั้น
//    header('Location: login.php?program=sales%20system&branch=' . (int)$sps['branch_id']
//           . '&goto_sps_booking=yes&Submit_right=' . rawurlencode('จองรถ')
//           . '&pros_id=' . (int)$prosId . '&cus_id=' . (int)$cusId . '&u_id=' . (int)$spsUid);
```

### 3.3 ยี่ห้อกับสาขา — SPS สลับยี่ห้อด้วยการสลับ "สาขา"

ตรวจ source ของ SPS แล้ว (`sps/login.php`, `sps/booking_form.php`) พบว่า:

- SPS **ไม่มี** session ของ "บริษัท" หรือ "ยี่ห้อ" ให้เลือกเอง ไม่มีตาราง company · มิติเดียวที่ใช้แบ่งคือ **สาขา** (`branch.branch_id`)
- ยี่ห้อถูกอนุมานจากสาขา: `login.php` อ่าน `branch.sto_br_id` แล้วตั้ง `$_SESSION['admin_brand_id']` / `admin_brand_desc` ให้เอง
- เมนู "สาขา" ในทุกหน้าของ SPS ก็คือลิงก์ `login.php?program=sales system&branch=<branch_id>` ซึ่งใช้ credential ที่ค้างใน session อยู่แล้ว จึงไม่ต้องกรอกรหัสผ่านซ้ำ
- มีตัวอย่างการ deep-link อยู่ใน SPS เองแล้วที่ `pros_form2.php` → `login.php?...&goto_sps_booking=yes&Submit_right=จองรถ&pros_id=…&cus_id=…&u_id=…` และ `login.php` จะ redirect ต่อเข้า `booking_form.php` ให้ — **ใช้เส้นทางเดิมนี้ ไม่ต้องเขียนใหม่**

ดังนั้นฝั่ง Lead FUN จึงเก็บรหัสของ SPS ไว้ตรงๆ (sql/035) และส่งมาให้ในบล็อก `lead.sps`:

| ฟิลด์ | มาจาก | ใช้ทำอะไร |
|---|---|---|
| `sps.branch_id` | `fun_branch.dms_branch_id` = `branch.branch_id` ของ SPS | ใส่ใน `login.php?branch=` เพื่อสลับสาขา ยี่ห้อจะตามมาเอง |
| `sps.sto_br_id` | `fun_brand.dms_brand_id` = `stock_brand.sto_br_id` | ไว้ตรวจทานว่ายี่ห้อที่ SPS อนุมานได้ตรงกับ Lead |
| `sps.brand_desc` | ชื่อยี่ห้อใน Lead FUN | ใช้เทียบกับ `stock_brand.sto_br_desc` ตอนสร้าง prospect |

แอดมิน Lead FUN กรอกการจับคู่นี้ที่ **ตั้งค่า › สาขาและแบรนด์** · สาขาที่ยังไม่ผูก ปุ่ม "เปิดใบจองใน SPS" จะไม่ยอมออก ticket และแจ้งให้ไปกรอกก่อน แทนที่จะพาไปเปิดใบจองผิดโชว์รูม

**ข้อควรระวังที่เจอใน source ของ SPS**

1. `booking_form.php` และ `booking_form4.php` **ไม่ได้** ใช้ `branch` จาก URL ในการตัดสินว่าใบจองอยู่สาขาไหน แต่ไปอ่านจากแถว `prospectcontact` ของ `pros_id` นั้น แล้วเขียนทับ session อีกรอบตอนกดบันทึก ⇒ `pros_id` ที่ส่งเข้าไปต้องเป็น prospect ที่ `branch_id` ตรงกับ `sps.branch_id` มิฉะนั้นใบจองจะถูกบันทึกคนละสาขากับที่ผู้ใช้เห็นบนหัวจอ
2. `pros_id` ที่ SPS รับ คือ `prospectcontact.pros_id` **ของ SPS เอง** ไม่ใช่ `handoff_id` ของ Lead FUN ⇒ `sso_land.php` ต้องสร้างหรือค้นแถว prospect ก่อน แล้วส่ง id ของ SPS
3. ผู้ใช้ต้องมีแถว `user_branch(u_id, branch_id)` ของสาขานั้น ไม่งั้น `login.php` เด้งกลับหน้า login พร้อม `msg_login_fail` ⇒ ถ้าเซลส์คนนั้นยังไม่มีสิทธิ์สาขานั้นใน SPS ให้แสดงข้อความให้ติดต่อแอดมิน อย่าสร้างสิทธิ์ให้อัตโนมัติ
4. `login.php` มี `checkIp()` ⇒ ถ้าเรียกจากนอกออฟฟิศต้องปลดที่ `adam_<branch>_config` (`config_code='10'` = `"0"`) หรือใช้ทางที่ตกลงกันไว้ อย่าใช้ `log_backdoor` เป็นทางถาวร
5. ทุก query ใน SPS ต่อสตริงดิบไม่ escape ⇒ ค่าที่ส่งใน URL ต้อง cast เป็น int ทุกตัวก่อนใช้ (`(int)$_REQUEST['pros_id']` ฯลฯ)

### 3.4 ขาเข้า — เมนู "Lead FUN" ใน SPS

เมื่อผู้ใช้ที่ login SPS อยู่กดเมนู:
```
POST https://fun.ch-erawan.com/api/sso/issue
X-Api-Token: <SSO_API_TOKEN>
Content-Type: application/json

{ "line_userid": "U9f…", "dms_user_id": 345, "target": "/leads" }
```
- ส่งอย่างน้อย 1 อย่างระหว่าง `line_userid` / `dms_user_id` (ส่งทั้งคู่ดีที่สุด) · `target` ต้องเป็น path ขึ้นต้นด้วย `/` (ค่าเริ่มต้น `/leads`)
- ตอบ 200: `{ "ok": true, "sso_url": "https://fun.ch-erawan.com/sso?ticket=…", "expires_at": "…", "user": { "fun_user_id": 12, "display_name": "…" } }`
- ตอบ 404 `USER_UNMAPPED` (ยังไม่มีบัญชี Lead FUN ที่ตรง) · 403 `USER_INACTIVE` · 401 `UNAUTHORIZED`
- SPS ทำ `header('Location: ' . $res['sso_url'])` ทันที (ticket อายุ 60 วินาที ใช้ได้ครั้งเดียว)

### 3.5 ข้อกำหนดความปลอดภัย

- `X-Api-Token` เทียบแบบ timing-safe ทั้งสองฝั่ง (`hash_equals()` ใน PHP)
- ticket ห้าม log แบบเต็ม ห้ามใส่ใน referer ที่หลุดออกนอกระบบ (หน้า `sso_land.php` ควร redirect ทันที)
- HTTPS ทั้งสองทาง · จำกัด IP ต้นทางของ `/api/sso/verify` และ `/api/sso/issue` เป็นเครื่อง SPS
- ถ้า token รั่ว: เปลี่ยน `SSO_API_TOKEN` ทั้งสองฝั่งพร้อมกัน (ไม่มี state อื่นต้องล้าง)

---

## 4. Audit log

Lead FUN บันทึกลง `fun_audit_log` ทุกเหตุการณ์ต่อไปนี้ (ดูได้ที่ `/logs` → Audit, export CSV ได้):
`auth.login`, `auth.login_failed`, `auth.logout`, `auth.sso_issue`, `auth.sso_verify`, `auth.sso_consume`, `user.create/update/approve/password_reset/perm_change`, `lead.create/update/stage/reassign/forfeit/claim/delete`, `quote.send`, `settings.update`, `report.export`, `perm.denied`, `webhook.rejected`

ฟิลด์: เวลา (ms) · ผู้ทำ (id/ชื่อ/บทบาท) · แหล่ง (web/api/job/webhook/sso) · action · ประเภท+id ของรายการ · สาขา · IP · user-agent · request id · ค่าก่อน/หลัง (เฉพาะฟิลด์ที่เปลี่ยน, ไม่มี password/token/เลขบัตร, เบอร์โทรถูกปิดบางส่วน) · ผล (ok/denied/error) · รายละเอียด

ขอให้ฝั่ง SPS log เหตุการณ์ SSO ฝั่งตัวเองในรูปแบบใกล้เคียงกัน (อย่างน้อย: เวลา, u_id, IP, ผล, `fun_user_id`/`lead_id` ที่ได้จาก verify) เพื่อให้ตามรอยข้ามระบบได้ด้วย `request_id`/เวลา

---

## 5. ซิงก์รุ่นรถและสี (SPS → Lead FUN)

Lead FUN แสดงรุ่นรถและสีในฟอร์มเพิ่ม Lead และใบเสนอราคา ข้อมูลชุดนี้ **SPS เป็นเจ้าของ** Lead FUN เป็นฝ่ายดึงมาแสดงอย่างเดียว ไม่มีการเขียนกลับ

### 5.1 วิธีเชื่อม

SPS ยังไม่มี API สำหรับรุ่น/สี มีแต่ไฟล์ autocomplete ที่คืน HTML และไม่ตรวจสิทธิ์ จึงใช้วิธีเดียวกับที่โปรเจกต์ CPT ใช้อยู่แล้ว คือ **ต่อ MySQL ของ SPS ตรงๆ ด้วยบัญชี SELECT อย่างเดียว**

สิ่งที่ขอจากฝ่าย IT ครั้งเดียว
```sql
CREATE USER 'funcatalog_ro'@'<app-host>' IDENTIFIED BY '<รหัสผ่านที่แข็งแรง>';
GRANT SELECT ON adam_prod.stock_brand      TO 'funcatalog_ro'@'<app-host>';
GRANT SELECT ON adam_prod.stock_model_main TO 'funcatalog_ro'@'<app-host>';
GRANT SELECT ON adam_prod.stock_model      TO 'funcatalog_ro'@'<app-host>';
GRANT SELECT ON adam_prod.stock_color      TO 'funcatalog_ro'@'<app-host>';
```
แล้วใส่ใน `.env` ของ Lead FUN เป็น `DMS_MYSQL_URL="mysql://funcatalog_ro:...@<dms-host>:3306/adam_prod"` · ถ้าเว้นว่าง การซิงก์จะปิดทั้งหมด · โค้ดฝั่งอ่านอยู่ที่ `src/lib/dms/reader.ts` และมีกฎเขียนไว้ในไฟล์ว่า SELECT เท่านั้น

### 5.2 ตารางที่อ่าน และการจับคู่

| SPS | Lead FUN | คีย์จับคู่ |
|---|---|---|
| `stock_brand.sto_br_id` | `fun_brand.dms_brand_id` | แอดมินกรอกเองที่ ตั้งค่า › สาขาและแบรนด์ |
| `stock_model_main` (ชื่อรุ่น 55 รายการ) | `fun_model` | `dms_model_id` = `sto_mo_ma_id` ครั้งแรกจับคู่ด้วยชื่อ |
| `stock_color` (500 สี ผูกกับชื่อรุ่น+ยี่ห้อ) | `fun_vehicle_color` | `dms_color_id` = `sto_co_id`, `color_code` = `sto_co_code` |

- `stock_model` อ่านเพื่อดูว่าชื่อรุ่นไหนยัง **มีรุ่นย่อยที่ขายอยู่** เท่านั้น ไม่ได้นำรุ่นย่อยหรือราคาเข้ามา
- สถานะเปิด/ปิดใช้ `st_id` ตามกติกาของ SPS คือ 1 กับ 3 ถือว่าใช้งานอยู่
- ชื่อสี ใช้ `sto_co_desc_th` ถ้ามี ถ้าไม่มีจะตัดข้อความก่อนวงเล็บของ `sto_co_desc` แบบเดียวกับที่ SPS แสดงเอง

### 5.3 พฤติกรรมที่ตกลงไว้

- ทำงานอัตโนมัติทุกคืนเวลา **02:00** และกดซิงก์เองได้ที่ ตั้งค่า › รุ่นรถและสี
- **ไม่ลบอะไรทั้งสิ้น** รุ่นหรือสีที่ SPS เลิกขายจะถูกปิดใช้งาน เพราะ Lead และใบเสนอราคาเก่ายังอ้างถึงอยู่
- รุ่น/สีที่ซิงก์มาจะแก้ชื่อ ลบ หรือเปิดปิดใน Lead FUN ไม่ได้ ต้องแก้ที่ SPS
- รุ่นที่แอดมินเคยพิมพ์เองไว้ ระบบจะจับคู่ด้วยชื่อให้อัตโนมัติในรอบแรก จะได้ไม่เกิดรายการซ้ำ
- ยี่ห้อที่ยังไม่ได้กรอกรหัส SPS จะถูกข้าม ไม่ถือเป็นข้อผิดพลาด
- ทุกรอบบันทึกลง audit log ด้วย action `settings.dms_sync`

---

## 6. Checklist ทดสอบร่วม

- [ ] `curl -H "X-Api-Token: …" https://fun.ch-erawan.com/api/permissions/export` ได้ JSON
- [ ] import `dryRun: true` ด้วยแถว `user_menu` ตัวอย่าง 1 คน → `matched: 1`, `unknownMenus` ว่าง
- [ ] ขาเข้า: `issue` ด้วย `line_userid` ของผู้ทดสอบ → เปิด `sso_url` ในเบราว์เซอร์ที่ **ยังไม่ได้ login** Lead FUN → เข้าหน้า `/leads` ได้
- [ ] เปิด `sso_url` เดิมซ้ำ → หน้า "ticket ใช้ไม่ได้"
- [ ] ขาออก: Lead ที่สถานะ "จองแล้ว" กด "เปิดใบจองใน SPS" → `sso_land.php` ได้ payload → เข้าหน้า `booking_form.php` โดยไม่ต้อง login
- [ ] เรียก `verify` ซ้ำด้วย ticket เดิม → `TICKET_USED` · รอ > 60 วิ → `TICKET_EXPIRED` · token ผิด → 401
- [ ] ทุกกรณีข้างต้นมีแถวใน `/logs` → Audit ของ Lead FUN

---

## 7. ค่าตั้งค่าทั้งหมด

### 7.1 ฝั่ง Ch.Lead FUN — ไฟล์ `.env` (บนเครื่องที่รัน: `/volume1/docker/fun/.env`)

| ตัวแปร | ตัวอย่าง | ถ้าไม่ตั้งค่า | ใครเป็นคนให้ค่า |
|---|---|---|---|
| `DMS_MYSQL_URL` | `mysql://funcatalog_ro:xxx@10.0.0.9:3306/adam_prod` | ปิดการซิงก์รุ่น/สีทั้งหมด ระบบทำงานปกติทุกอย่าง | IT (บัญชี SELECT อย่างเดียว) |
| `SSO_API_TOKEN` | สตริงสุ่ม ≥ 32 ไบต์ (`openssl rand -base64 32`) | `/api/sso/verify`, `/api/sso/issue` ตอบ 401 เสมอ | Nutt สร้าง แล้วส่งให้ทีม SPS |
| `SPS_SSO_LANDING_URL` | `https://system.ch-erawan.com/sps/sso_land.php` | ปุ่ม "เปิดใบจองใน SPS" ไม่แสดงให้ใครเห็น | ทีม SPS แจ้ง |
| `SSO_TICKET_TTL_SEC` | `60` | ใช้ค่า 60 วินาที | ค่าเริ่มต้น ไม่ต้องแก้ |
| `SPS_URL` | `http://system.ch-erawan.com/sps/` | ใช้ค่าเริ่มต้นนี้อยู่แล้ว | ลิงก์ในเมนู "สลับไประบบอื่น" |
| `APP_PUBLIC_URL` | `https://fun.ch-erawan.com` | `sso_url` ที่ส่งกลับให้ SPS จะไม่มีชื่อโดเมน | ตั้งไว้แล้วใน `docker-compose.yml` |
| `AUDIT_RETENTION_DAYS` | `365` | ใช้ 365 วัน (auth/สิทธิ์เก็บ 2 เท่า) | ค่าเริ่มต้น |

วิธีใส่ค่าและทำให้มีผล: แก้ `/volume1/docker/fun/.env` แล้ว
```bash
cd /volume1/docker/fun && docker compose up -d
```
ไม่ต้อง build ใหม่ ค่าเหล่านี้อ่านตอนรัน · **สวิตช์ปิด**: ลบค่าออกแล้วสั่งคำสั่งเดิม ระบบจะกลับไปทำงานแบบไม่มีการเชื่อมต่อ ไม่มีข้อมูลเสียหาย

### 7.2 ฝั่ง SPS ต้องมี

| รายการ | ค่า | ใช้ที่ไหน |
|---|---|---|
| ค่าคงที่ `SSO_API_TOKEN` | ตัวเดียวกับฝั่ง Lead FUN | ส่งเป็น header `X-Api-Token` ทุกครั้งที่เรียก Lead FUN |
| Base URL ของ Lead FUN | `https://fun.ch-erawan.com` | ปลายทางของ `verify` / `issue` / `permissions` |
| ไฟล์ `sso_land.php` | ไฟล์ใหม่ ห้ามแก้ไฟล์เดิมของ SPS | รับ ticket ขาออก (§3.2) |
| เมนู "Lead FUN" | ลิงก์ที่เรียก `/api/sso/issue` ฝั่ง server | ขาเข้า (§3.4) |

### 7.3 เครือข่าย

ทิศทางการเชื่อมต่อมีสองเส้น แยกกันคนละทาง

| เส้น | จาก | ไป | โปรโตคอล | ใช้ทำอะไร |
|---|---|---|---|---|
| 1 | เครื่อง SPS | `fun.ch-erawan.com` | HTTPS 443 | เรียก `verify` / `issue` / `permissions` |
| 2 | เครื่องที่รัน Lead FUN (`192.168.0.10`) | `<dms-host>` | MySQL 3306 | อ่านแคตตาล็อกรุ่น/สี |

ไม่มีเส้นทางไหนที่ Lead FUN เขียนลงฐานข้อมูล SPS และไม่มีเส้นทางไหนที่ SPS ต่อฐานข้อมูลของ Lead FUN โดยตรง

---

## 8. สถานะ ณ วันส่งมอบ (2026-09-10)

### ฝั่ง Lead FUN — เสร็จและใช้งานจริงแล้ว

- สิทธิ์รายเมนู 6 ธง + export/import (`sql/032`)
- Audit log + หน้าดู/export CSV (`sql/033`)
- SSO ทั้งสองทิศทาง ฝั่งเราครบ (`sql/034`) — endpoint พร้อมรับ รอเพียงฝั่ง SPS
- จับคู่สาขา/ยี่ห้อกับ SPS (`sql/035`) — ทุกสาขากรอกรหัส SPS ครบแล้ว
- ซิงก์รุ่นรถและสี (`sql/036`) — โค้ดพร้อม รอบัญชีฐานข้อมูล
- migration `032`–`036` รันบน production แล้วทั้งหมด

### ค้างอยู่

| รายการ | ติดที่ | ผลตอนนี้ |
|---|---|---|
| `DMS_MYSQL_URL` | รอบัญชี SELECT จาก IT | ยังไม่ซิงก์รุ่น/สี ใช้ข้อมูลที่กรอกเองอยู่ |
| `SSO_API_TOKEN`, `SPS_SSO_LANDING_URL` | รอ `sso_land.php` ฝั่ง SPS | ปุ่ม "เปิดใบจองใน SPS" ยังไม่แสดง เซลส์คีย์ใบจองใน SPS เองตามปกติ |
| รหัสยี่ห้อ SPS (`dms_brand_id`) | รอ Nutt กรอก | การซิงก์จะข้ามยี่ห้อที่ยังไม่ผูก |
| `dms_user_id` ของผู้ใช้ | รอรายชื่อจากทีม SPS | SSO จะใช้ `line_userid` เป็นหลักได้อยู่แล้ว |

### ข้อควรระวังที่พบระหว่างพัฒนา (ส่งต่อให้ทีม SPS รับทราบ)

1. ทุก query ใน SPS ต่อสตริงดิบไม่ escape และไฟล์ autocomplete ไม่ตรวจ session — ค่าใน URL ที่ส่งเข้า SPS ต้อง cast เป็น int ทุกตัว
2. `booking_form.php` และ `booking_form4.php` อ่านสาขา/ยี่ห้อจากแถว `prospectcontact` ของ `pros_id` แล้วเขียนทับ session ตอนบันทึก — ต้องสร้าง prospect ในสาขาที่ถูกต้องก่อนเสมอ
3. `login.php` มี `checkIp()` — การเรียกจากนอกออฟฟิศต้องตกลงวิธีปลดล็อกให้ชัด อย่าใช้ `log_backdoor` เป็นทางถาวร
4. มี LINE channel access token เขียนไว้ตรงๆ ในไฟล์ใต้ web root ของ SPS (`linedep/1.php`) ควรย้ายออกและเปลี่ยน token
5. ฝั่ง Lead FUN เอง: รหัสผ่านฐานข้อมูลถูก commit อยู่ใน `docker-compose.yml` และ `.env.example` ควรเปลี่ยนรหัสและย้ายไปไฟล์ที่ไม่ commit

---

## 9. คำสั่งทดสอบด่วน (คัดลอกไปวางได้)

แทน `TOKEN` ด้วยค่า `SSO_API_TOKEN` ที่ตกลงกัน

```bash
# 1) token ถูกต้องหรือไม่ (ควรได้ 400 BAD_REQUEST ไม่ใช่ 401)
curl -s -X POST https://fun.ch-erawan.com/api/sso/issue \
  -H "X-Api-Token: TOKEN" -H "Content-Type: application/json" -d '{}'

# 2) ออก ticket ขาเข้าให้ผู้ใช้คนหนึ่ง แล้วเปิด sso_url ในเบราว์เซอร์ที่ยังไม่ล็อกอิน
curl -s -X POST https://fun.ch-erawan.com/api/sso/issue \
  -H "X-Api-Token: TOKEN" -H "Content-Type: application/json" \
  -d '{"dms_user_id": 123, "target": "/leads"}'

# 3) ดึงสิทธิ์ผู้ใช้ทั้งหมดเป็น JSON
curl -s https://fun.ch-erawan.com/api/permissions/export -H "X-Api-Token: TOKEN"

# 4) ทดสอบ import แบบยังไม่เขียนจริง
curl -s -X POST https://fun.ch-erawan.com/api/permissions/import \
  -H "X-Api-Token: TOKEN" -H "Content-Type: application/json" \
  -d '{"dryRun": true, "rows": [{"u_id": 123, "u_me_menu": "pros2", "u_me_add": "1"}]}'

# 5) ticket ปลอม ต้องได้ TICKET_INVALID
curl -s -X POST https://fun.ch-erawan.com/api/sso/verify \
  -H "X-Api-Token: TOKEN" -H "Content-Type: application/json" -d '{"ticket": "not-a-real-ticket"}'
```
