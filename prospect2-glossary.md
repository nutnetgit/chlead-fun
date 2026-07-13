# Prospect 2.0 — Glossary

> คำศัพท์กลางของโปรเจกต์ · ให้ทุกคน (คน + Claude Code) เข้าใจตรงกัน · เติมระหว่าง grilling

| คำ | ความหมาย |
|---|---|
| **Ch.Lead FUN** | **ชื่อทางการของระบบใหม่ทั้งก้อน** (เดิมเรียกชื่อทำงานว่า Prospect 2.0) — ADR-012b |
| **Prospect 2.0** | ชื่อทำงานเก่าของ Ch.Lead FUN ในเอกสารช่วงออกแบบ · ระบบเดียวกัน |
| **FB intake adapter** | ตัวดึง FB Lead Ads (คือ "Ch.Lead FUN เดิม" ก่อนรวม) — โมดูลหนึ่งของระบบ เปิดหลัง Meta review |
| **parallel run** | ช่วง 1–2 เดือนที่เซลส์ทำงานบน Ch.Lead FUN แต่ SPS เดิมยังเข้าได้ · มี automated check จับ lead ที่หลุดไปสร้างในระบบเก่า (ADR-013) |
| **cutover gate** | เกณฑ์วัดอัตโนมัติสำหรับปิดระบบเก่า: ≥95% lead ใหม่อยู่ในระบบใหม่ 2 สัปดาห์ติด + ไม่มี SLA breach ค้าง + ผจก.ยืนยันใช้ dashboard |
| **SPS (หลัก)** | Sales Process System เดิม — ระบบการเงิน/บัญชี (จอง, stock, ป้ายแดง, รับเงิน) **ไม่แตะ** |

| **Sabai** | AI agent ภายในองค์กร (Ollama local) · อนาคตแทน Gemini สำหรับร่างข้อความ on-prem |
| **CATS** | โปรเจกต์เดิมของ Nutt · แหล่ง reusable pattern (FB, LINE, Settings UI) |
| **person** (`fun_person`) | บุคคล 1 คน = 1 แถวตลอดชีวิต · แยกจาก lead |
| **lead** (`fun_lead`) | โอกาสขาย 1 ครั้ง · คนเดียวมีได้หลาย lead |
| **HWC / temperature** | Hot / Warm / Cold · ระดับความร้อนแรงของ lead (เดิมตั้ง manual) |
| **ai_score** | คะแนน 0–100 ที่ AI ให้ (Gemini) · แยกจาก temperature ที่คนตั้ง |
| **activity** (`fun_activity`) | ทุก touch point · append-only ห้ามแก้ทับ |
| **SLA** | เกณฑ์เวลาตอบสนอง/ติดตาม เก็บใน `fun_sla_rule` แยกตาม temperature |
| **idle → nudge → escalate → forfeit** | บันไดเมื่อ lead ค้าง: เตือนเซลส์ → แจ้ง ผจก. → ริบเข้า pool |
| **lead pool** (`fun_lead_pool`) | คิว lead ไร้เจ้าของ (ถูกริบ/ใหม่) รอแจกใหม่ |
| **nurture** | โหมดเลี้ยง lead เย็นด้วยการตลาดอัตโนมัติ แทนการริบทิ้ง |
| **Booking Handoff** (`fun_booking_handoff`) | snapshot ข้อมูลจอง ส่งต่อให้การเงินกรอก SPS · **ประตูบังคับ** (ADR-010): การเงินกรอก SPS ได้ก็ต่อเมื่อมี Handoff นี้ |
| **break-glass** | ทางออกฉุกเฉินของ ADR-010 — กรอก SPS ตรงได้แต่ต้องระบุเหตุผล+ตามเก็บ Handoff ใน 24 ชม. + นับสถิติรายสาขา |
| **mandate** | อำนาจสั่งการที่ต้องมาจากเจ้าของกลุ่ม (ไม่ใช่ Nutt) เพื่อให้ ADR-010 มีเขี้ยวจริง |
| **consent** (`fun_person_consent`) | ความยินยอม PDPA · เงื่อนไขก่อนส่งข้อความอัตโนมัติทุกชนิด |
| **temperature_conflict** | flag บน `fun_lead` เมื่อ temperature กับ ai_score ห่างกัน >1 ระดับ → SLA บังคับเป็น Warm + badge มองเห็นได้ (ADR-011) |
| **sla_override** | `fun_activity` type ที่เซลส์ยืนยันค่า temperature เดิมทับ ai_score พร้อมเหตุผลบังคับ · ผจก.เห็น aggregate รายเซลส์ |
| **intake adapter** | ตัวรับ lead จากช่องทางภายนอก (FB Lead Ads ตัวแรก) เขียนเข้า `fun_lead` |
| **reconcile** | (ตัดจาก scope) จับคู่ข้อมูล 2 ระบบ — ไม่ทำในเฟสนี้ |
