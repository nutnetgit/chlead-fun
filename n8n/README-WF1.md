# [FUN] n8n workflows — คู่มือติดตั้ง (import เข้า n8n.ch-erawan.com)

> **ทำไม webhook ต้องอยู่ที่ n8n ไม่ใช่แอป:** แอป Settings deploy แบบ LAN-only
> (`192.168.0.10:3102`) — LINE/Meta ต้อง verify webhook ผ่าน URL public HTTPS
> เข้าไม่ถึง LAN. n8n (`n8n.ch-erawan.com`) public อยู่แล้ว จึงรับ webhook ทั้งหมด.

## workflow เสริม: `FUN-line-groupid-capture.json` (จับ LINE Group ID)

Import แล้ว: (1) เลือก MySQL credential `MariaDB n8n_fun` เดียวกับด้านล่างในโหนด
"Save to fun_settings" (2) Activate (3) ตั้ง Webhook ของ LINE OA มาที่
`https://n8n.ch-erawan.com/webhook/fun-line-events`.
มันเขียน `line_last_group_id` ลง `ch_lead_fun.fun_settings` → หน้า `/channels`
ของแอปอ่านค่านี้แล้วโชว์ปุ่ม "ใช้ค่านี้" อัตโนมัติ (แอปไม่ต้อง public).

---

# [FUN] WF1 Intake — คู่มือติดตั้ง

ไฟล์: `FUN-WF1-intake.json` — ครอบคลุม 2 endpoint ตาม handoff §4:
- `POST /webhook/fun-lead-fb` — Meta leadgen webhook (+ `GET` สำหรับ hub.challenge)
- `POST /webhook/fun-lead-web` — walk-in form (Turnstile)

## ขั้นตอนหลัง import (ต้องทำครบทุกข้อ)

1. **MySQL credential** — เปิดโหนด MySQL ทั้ง 4 ตัว (Lookup ×2, Upsert Lead, Log Reopen Activity) แล้วเลือก/สร้าง credential ชื่อ `MariaDB n8n_fun`:
   host `mariadb-erawan` · port `3306` · database **`ch_lead_fun`** · user `n8n_fun` · password `Er@w@n12345`
   (n8n อยู่บน hermes-net เดียวกับ mariadb-erawan แล้ว จึงต่อผ่าน hostname ได้เลย. ถ้าต่อจากนอก Docker ใช้ `192.168.0.10` port **3308**.)
2. **แทน placeholder ทั้ง 5 จุด** (Phase 1 secrets อยู่ใน n8n ตามที่ตกลง):
   - `__META_VERIFY_TOKEN__` (โหนด "Verify token?") — สตริงสุ่มตั้งเอง ใช้ตอน subscribe webhook กับ Meta
   - `__META_APP_SECRET__` (โหนด "Verify Signature + Extract") — App Secret ของ Meta App
   - `__FB_SYSTEM_USER_TOKEN__` (โหนด "Fetch Lead (Graph API)") — System User token `n8n-lead-bot` (ไม่หมดอายุ)
   - `__LINE_CHANNEL_ACCESS_TOKEN__` (โหนด "LINE Push New Lead") — token ของ OA ใหม่ **CEA Sales Assistant** (ห้ามใช้ของ Nong Count)
   - `__TURNSTILE_SECRET__` (โหนด "Verify Turnstile") — Cloudflare Turnstile secret key
3. **n8n env**: โหนด verify signature ใช้ `require('crypto')` — ต้องมี `NODE_FUNCTION_ALLOW_BUILTIN=crypto` (หรือ `*`) ใน env ของ n8n container แล้ว restart n8n หนึ่งครั้ง
4. เพิ่มแถวใน `fun_channel_config` อย่างน้อย 1 เพจ (ผ่าน Settings app หรือ SQL ตรง) — ถ้า lookup ไม่เจอ เพจนั้นจะถูกเงียบทิ้ง (ตั้งใจ ให้เปิดทีละ brand ตามแผน pilot)
5. Activate workflow แล้วทดสอบ:
   - Meta App → Webhooks → subscribe object **Page**, field **leadgen**, URL `https://n8n.ch-erawan.com/webhook/fun-lead-fb`, verify token ตามข้อ 2
   - ยิงทดสอบด้วย **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing) ก่อนเปิดโฆษณาจริง

## พฤติกรรมสำคัญที่ฝังไว้แล้ว

- ✅ verify `X-Hub-Signature-256` (HMAC-SHA256 + timingSafeEqual) — request ปลอมถูก throw ทิ้ง
- ✅ dedupe ตาม §3: `INSERT … ON DUPLICATE KEY UPDATE status='new', next_followup_date=CURDATE()` — ลูกค้าเดิมทักซ้ำไม่ error แต่ reopen + ลง activity `reopen` + การ์ด LINE เปลี่ยนเป็น "🔁 ลูกค้าเดิมทักซ้ำ"
- ✅ ตอบ Meta 200 ทันที (`onReceived`) แล้วค่อยประมวลผล — ไม่โดน Meta ตัด webhook เพราะ timeout
- ✅ Flex card "ลีดใหม่" ส่งเข้ากลุ่มตาม `fun_channel_config` + footer ย้ำกติกา "AI ไม่ทักลูกค้าเอง"
- ✅ walk-in ตรวจ Turnstile ก่อนเสมอ, consent_flag ตาม checkbox ในฟอร์ม (FB lead = 1 เพราะฟอร์มมี consent notice)
- ✅ SQL literal ถูก escape ในโค้ด (กัน injection จากข้อความลูกค้า) เพราะ query-parameter field ของ n8n แตกเมื่อค่ามี comma

## ยังไม่รวมใน WF1 (ตาม scope §4)

- หน้าเว็บ walk-in form (Cloudflare Pages + Turnstile widget) — payload ที่ฟอร์มต้อง POST:
  `{ brand, branchCode, name, phone, model, budget, message, consent, turnstileToken }`
- health check เขียน `fun_settings` (fb_token_health ฯลฯ) — จะใส่เป็น cron แยกตอนทำ WF2/WF3
