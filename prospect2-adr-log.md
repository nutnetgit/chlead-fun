# Prospect 2.0 — Architecture Decision Record (ADR) Log

> บันทึกการตัดสินใจเชิงสถาปัตยกรรม · สร้างระหว่าง grilling session
> แต่ละ ADR = การตัดสินใจหนึ่งเรื่อง พร้อมบริบทและผลที่ตามมา · แก้ไม่ได้ย้อนหลัง เปลี่ยนใจให้เขียน ADR ใหม่ที่ supersede อันเก่า

---

## ADR-001 — รื้อสร้างใหม่ ไม่ patch ของเดิม
**Status:** Accepted
**Context:** โมดูล Prospect เดิมใน SPS มี SQL injection 142 จุด, password MD5, เลขบัตร plain text, การริบ lead ทำงานตอน login เท่านั้น, ไม่มี API
**Decision:** สร้าง Prospect 2.0 ใหม่ทั้งหมด แยกจาก SPS
**Consequences:** ได้ระบบสะอาด/ปลอดภัย แต่ต้อง migrate ข้อมูล + คู่ขนานกับของเดิมช่วง transition

## ADR-002 — Scope จบที่ "ลูกค้าต้องการจอง"
**Status:** Accepted
**Context:** SPS หลักจัดการเงินจริง (จอง/ดาวน์/ค่ารถ/ป้ายแดง) เป็น source of truth ทางบัญชี
**Decision:** Prospect 2.0 จบที่ booking → generate Booking Handoff ส่งต่อการเงิน · ไม่แตะ/ไม่อ่าน/ไม่เขียน SPS หลัก
**Consequences:** ทำงานอิสระ 100% ไม่ต้องรอ DB access ของ SPS · แต่มี double-entry ที่ต้องจัดการ (→ ดู open question)

## ADR-003 — แยก "คน" ออกจาก "โอกาสขาย"
**Status:** Accepted (⚠ ท้าทายใน grilling)
**Context:** DMS เดิมผูกลูกค้ากับ prospect เป็นก้อนเดียว ทำให้ประวัติขาด
**Decision:** `fun_person` (คน 1 แถวตลอดชีวิต) แยกจาก `fun_lead` (โอกาสขาย หลายครั้งได้)
**Consequences:** ประวัติลูกค้าเต็ม + ต่อยอดระบบอนาคตได้ · แต่เพิ่ม join complexity

## ADR-004 — แทนกฎ 60 วัน ด้วย SLA หลายชั้นที่เก็บเป็นข้อมูล
**Status:** Accepted
**Context:** กฎเดิม 60 วันนานเกินไป ไม่มีเตือนก่อน ริบแล้วหาย ทำงานตอน login
**Decision:** SLA แยกตาม temperature (nudge→escalate→forfeit) เก็บใน `fun_sla_rule` ผจก.ปรับเองได้ · รันด้วย n8n cron รายชั่วโมง
**Consequences:** lead ไม่หลุดเงียบ + ปรับได้ต่อแบรนด์ · แต่ประสิทธิผลขึ้นกับว่า ผจก.บังคับใช้จริงไหม (→ grilling)

## ADR-005 — รวม Ch.Lead FUN เป็น adapter ไม่ใช่ระบบแยก
**Status:** Accepted
**Context:** Ch.Lead FUN (ดึง FB Lead Ads + scoring + nudge) ใช้ prefix `fun_` เดียวกัน ยังไม่ deploy (ค้าง Meta review)
**Decision:** Prospect 2.0 = superset · FB Lead Ads = intake adapter เสียบทีหลัง ไม่บล็อกแกนกลาง · reuse Settings UI + Gemini + LINE pattern
**Consequences:** ไม่ต้องรอ Meta · งานเดิมไม่เสียเปล่า · ต้อง reconcile naming (`fun_leads`→`fun_lead`)

## ADR-006 — Booking Handoff (ไม่เขียนข้ามระบบ)
**Status:** Accepted
**Context:** ต้องส่งข้อมูลจองให้การเงินโดยไม่แตะ SPS
**Decision:** Prospect 2.0 generate snapshot ข้อมูลครบ → การเงิน copy กรอก SPS เอง → กดยืนยัน completed
**Consequences:** SPS ยังเป็น source of truth บัญชี · แต่มี manual re-entry (→ grilling)

## ADR-007 — Design language: clean teal / IBM Plex Sans Thai
**Status:** Accepted (locked โดย Nutt)
**Context:** ต้องการ minimal นุ่มตา ตระกูลเดียวกับ CATS แต่มีเอกลักษณ์ฝ่ายขาย
**Decision:** warm off-white, accent teal `#0F7A66`, IBM Plex Sans Thai, hairline border
**Consequences:** ต่างจาก CATS ชัด · ใช้ทั้ง LINE + Web

## ADR-008 — เซลส์และ ผจก. ใช้ได้ทั้ง LINE + Web
**Status:** Accepted
**Decision:** LINE = เร็ว/แจ้งเตือน/สั่งด่วน · Web = ดูลึก/กรอกละเอียด/วิเคราะห์ · core DB เดียว sync กัน
**Consequences:** ครอบคลุมทุกบริบทการใช้งาน · แต่ต้อง build 2 frontend

## ADR-009 — AI ร่าง คนส่ง
**Status:** Accepted (กฎบริษัท inherited)
**Decision:** AI ไม่ทักลูกค้าโดยตรงเด็ดขาด · ร่างข้อความให้เซลส์ copy ส่งเอง
**Consequences:** ปลอดภัย/ควบคุมได้ · แต่ต้องพึ่งวินัยเซลส์ในการส่ง (→ grilling adoption)

## ADR-010 — Booking Handoff เป็นประตูบังคับ (mandate-dependent)
**Status:** 🟡 Proposed — รอ mandate จากเจ้าของกลุ่ม (Nutt ประเมิน "น่าจะได้" ไม่ใช่ "ได้แน่")
**Context:** ระบบเดิมล้มเหลวเพราะพึ่งวินัยเซลส์ล้วน ๆ (Hot lead ค้าง 33–53 วันทั้งที่ระบบมีข้อมูลครบ) · "ง่ายกว่าเดี๋ยวก็ใช้เอง" คือกับดักของ CRM ที่ล้มเหลวทุกตัว · (ก) อย่างเดียวไม่พอ ต้องมี (ค) จุดที่เลี่ยงไม่ได้ แต่จุดจองจริงเกิดใน SPS หลักซึ่ง Prospect 2.0 ไม่คุม (ADR-002)
**Decision:**
- **เขี้ยว:** ประกาศกฎองค์กรว่า "ฝ่ายการเงินกรอก SPS ให้ก็ต่อเมื่อมี Booking Handoff จาก Prospect 2.0" — **กฎต้องออกจากเจ้าของกลุ่ม ไม่ใช่จาก Nutt** (กฎเชิงอำนาจ ไม่ใช่เชิงเทคนิค คนออกกฎต้องใหญ่กว่าคนที่จะมาขอละเมิด)
- **Break-glass:** กรอก SPS ตรงได้ในเหตุฉุกเฉิน (ระบบล่ม/นายพาลูกค้ามาเอง) แต่ (1) ต้องระบุเหตุผล+ผู้อนุมัติ (2) ต้องมี Handoff ตามหลังใน 24 ชม. ไม่งั้น deal ขึ้นแดงบน dashboard ผจก. (3) นับสถิติ break-glass รายสาขา/เดือน — หลักคิด: ไม่ห้ามละเมิด แต่ทำให้ละเมิดมองเห็นได้เสมอ
- **ตัวเสริม (ผูก ก เข้ากับ ค):** Booking Handoff generate อัตโนมัติจากข้อมูลที่บันทึกระหว่างทาง (activity/quotation/finance) — บันทึกครบ = ตอนจบไม่ต้องกรอกใหม่เลย · ไม่เคยบันทึก = ต้องกรอกมือทั้งหมด (เจ็บ) → ความง่ายตอนจบคือรางวัลของการบันทึกระหว่างทาง
- (ก) เสริม: ระบบ push "วันนี้ต้องตามใคร" (เซลส์ทำเองไม่ได้) + AI ร่างข้อความ + voice-to-text ลด friction ฝั่งบันทึก
**Consequences:**
- mandate ผ่าน → เขี้ยวแข็งแรงที่สุดที่มี เพราะผูกกับเงินจริง
- mandate ไม่ผ่าน/หลวม → (ค) ไม่มีเขี้ยวจริง เหลือแค่ (ก) ล้วน ๆ ซ้ำรอยความล้มเหลวของกฎ 60 วันเดิม
- **ความเสี่ยงอันดับ 1 ของทั้งโปรเจกต์คือ mandate นี้ ไม่ใช่ schema/โค้ด** — ต้องทดสอบใจเจ้าของกลุ่มคู่ขนานกับการ build ไม่ใช่รอสร้างเสร็จแล้วค่อยถาม
**Open action:** Nutt นำเสนอเจ้าของกลุ่มขอ mandate อย่างเป็นทางการ · ได้ → Accepted · ไม่ได้ → กลับมา grill ทางเลือก (2)/(3)/(4) ที่เคยเสนอไว้ (ย้าย gate ไปจุดก่อนเงิน / ยอมรับเขี้ยวอ่อนกว่า / ทบทวน ADR-002)

---

## ADR-011 — ขัดกันระหว่าง temperature (manual) กับ ai_score → Warm + flag มองเห็นได้
**Status:** Accepted
**Context:** `temperature` (Hot/Warm/Cold ตั้งโดยเซลส์) กับ `ai_score` (0–100 จาก Gemini) ทั้งคู่ขับเคลื่อน SLA (ADR-004) แต่จะขัดกันทุกวันเพราะเซลส์กับ AI มองคนละมุมของลูกค้า · ทดสอบแล้วว่า "ใช้ SLA เข้มสุดของสองค่า (max)" แก้ได้แค่ทิศทางเดียว (ป้องกันไม่ได้เมื่อเซลส์ตั้ง Hot เกินจริง) และเสี่ยง alert fatigue ไหลไปกอง ผจก. (ทำลาย ADR-004) · "แก้เงียบ ๆ เป็น Warm" เสี่ยงทำลายความไว้ใจแบบเดียวกับที่ ADR-010 พยายามป้องกัน แค่เนียนกว่า
**Decision:**
1. **Mapping ai_score → temperature-equivalent:** 70–100=Hot, 35–69=Warm, 0–34=Cold
2. **ขัดกัน** = ห่างกัน >1 ระดับ (Hot↔Cold) → **บังคับเป็น Warm** · ห่าง ≤1 ระดับ (Hot↔Warm, Warm↔Cold) → ใช้ temperature ที่เซลส์ตั้งไปเลย ไม่ยุ่ง
3. **ทุกครั้งที่บังคับเป็น Warm ต้องมี badge มองเห็นได้ทุกที่ที่การ์ด lead แสดง** (LINE Flex, Web list, Dashboard) — ไม่ใช่แค่หน้ารายละเอียด — พร้อมปุ่มดูเหตุผลของ AI
4. **Override ต้องกรอกเหตุผลบังคับ** (ไม่ใช่กดเฉย ๆ) → เก็บเป็น `fun_activity` type ใหม่ `sla_override` อยู่ใน timeline เดียวกับประวัติจริง
5. **ผจก. เห็น aggregate override รายเซลส์/เดือน** — override ถี่แบบไม่มีเหตุผลจริง = สัญญาณเซลส์หลบ SLA ไม่ใช่ AI ผิด
**หลักการที่ตั้งเป็นมาตรฐานเดียวกันทั้งระบบ (เชื่อมกับ ADR-010):** ไม่ล็อกพฤติกรรมมนุษย์ตายตัว แต่ทำให้ทุกการเบี่ยงเบนจากกฎ **มองเห็นได้เสมอ**
**Consequences:** ai_score แม่นขึ้นเรื่อย ๆ จาก override pattern ที่เก็บได้ (ป้อนกลับปรับ prompt) · เพิ่ม field `fun_lead.temperature_conflict` (boolean) + `fun_activity.activity_type='sla_override'` เข้า schema

---

## ADR-012 — Fresh start: ไม่ import lead/ประวัติเก่า · import เฉพาะตัวตนลูกค้า
**Status:** Accepted
**Context:** ลูกค้าเก่าในฐาน SPS ไม่มี consent PDPA ที่แท้จริง (ระบบเก่าไม่มี concept นี้) แต่ Ch.Lead FUN ทั้งระบบมีกฎเหล็ก "ไม่มี consent = automation ไม่แตะ" · การตีความ legitimate interest เป็นความเสี่ยงกฎหมายที่ไม่ควรแบกตอนเปิดระบบ
**Decision (Nutt): ระดับ (i)**
- `fun_person` seed จากตาราง `customer` เดิม (ชื่อ/เบอร์/ที่อยู่) เพื่อให้ **dedup ทำงาน** — คนเดิมกลับมา ระบบจำได้
- `fun_lead` / `fun_activity` **เริ่มจากศูนย์** — ไม่ import `prospectcontact`/`prospect_follow`
- person ที่ import มา = **ไม่มี consent** → automation (nudge/AI draft/broadcast) ไม่แตะจนกว่าจะมี consent ใหม่จากการติดต่อจริงครั้งถัดไป · เซลส์ติดต่อเองแบบ human ได้ตามปกติ
- lead ที่ยัง active ในระบบเดิม → เซลส์สร้างใหม่ใน Ch.Lead FUN เอง (เฉพาะรายที่ยังตามจริง — เป็นการ**คัดกรองไปในตัว** ว่า lead ไหนยังมีชีวิต)
**Consequences:** ตัดความเสี่ยง PDPA ตั้งแต่ต้นทาง · migration งานเบาลงมาก (เหลือ customer master + dimensions) · แลกกับ: เซลส์ต้อง re-enter lead ที่กำลังตามอยู่ (ยอมรับได้เพราะรายที่ตามจริงมีไม่มาก — หลักฐาน: มาสด้า สนญ. active แค่ 2 ราย) · **ตัด §4 legacy lead import ออกจาก handoff, ตัด build order ขั้น 4**

## ADR-012b — Naming: ระบบใหม่ชื่อทางการ "Ch.Lead FUN"
**Status:** Accepted
**Context:** เอกสาร/mockup ทั้งหมดใช้ชื่อทำงาน "Prospect 2.0" · Nutt ยืนยันชื่อจริงของระบบใหม่ทั้งก้อน (รวม FB adapter เดิม) คือ **Ch.Lead FUN**
**Decision:** ชื่อทางการ = Ch.Lead FUN · "Prospect 2.0" = ชื่อทำงานในเอกสารเก่า · ต้องทำ rename pass ในเอกสาร+UI ก่อนส่งมอบจริง (ไม่เร่งด่วน)
**Consequences:** prefix `fun_` ยิ่งสมเหตุสมผล · ระวังสับสนกับ "Ch.Lead FUN เดิม" (FB adapter) — ใน glossary แยกเป็น "FB intake adapter"

## ADR-013 — Parallel run มีกำหนดจบ + cutover gate วัดอัตโนมัติ
**Status:** Accepted
**Context:** Nutt ต้องการเปิดคู่ขนาน: เซลส์ทำงานบน Ch.Lead FUN, SPS Prospect เดิมยังเข้าได้ 1–2 เดือนจน trial ผ่าน · ความเสี่ยงคลาสสิก: "ชั่วคราว" กลายเป็นถาวร + lead ใหม่กระจาย 2 ระบบ · แนวทาง "บังคับพนักงานเอง" ถูกท้วงว่าซ้ำรอยกฎ 60 วันเดิม (พึ่งวินัยคน ไม่ scale กับ 9 สาขา)
**Decision:**
- SPS เดิม**ยังใช้ได้เต็ม** (ไม่ technical lock — ระบบอื่นยังพึ่ง SPS อยู่) แต่มี **automated check รายวัน**: n8n query DB เดิมนับ lead ใหม่ที่ถูกสร้างใน SPS Prospect · พบ >0 → แจ้ง Nutt + ผจก.สาขานั้นทันที (หลักการเดิม: ไม่ล็อกพฤติกรรม แต่ทำให้เบี่ยงเบนมองเห็นได้เสมอ — เชื่อม ADR-010/011)
- **Cutover gate (เกณฑ์ปิดระบบเก่า — วัดอัตโนมัติ ไม่ใช้ความรู้สึก):**
  1. ≥95% ของ lead ใหม่ทั้งหมดถูกสร้างใน Ch.Lead FUN ติดต่อกัน 2 สัปดาห์
  2. ไม่มี SLA breach ที่ไร้คนจัดการค้างเกินเกณฑ์
  3. ผจก.ทุกสาขายืนยันใช้ dashboard แทนการขอรายงานมือ
- Booking Handoff (ADR-010) ใช้ตั้งแต่วันแรกของ parallel run — การจองทุกรายผ่านระบบใหม่
**Consequences:** trial มีเส้นชัยที่วัดได้ · lead กระจาย 2 ระบบถูกจับได้ภายใน 24 ชม. · ต้องมี read-only DB access ของ SPS เดิมสำหรับ automated check (งานเดียวที่ยังต้องแตะ DB เก่า — นอกเหนือจาก one-time person import)

---

## ADR-014 — MVP = Pilot สาขาเดียว (มาสด้า สนญ.) 1 เดือน ก่อน roll out
**Status:** Accepted
**Context:** ความเสี่ยงอันดับ 1 คือ mandate + adoption ไม่ใช่โค้ด (ADR-010) → MVP ต้องพิสูจน์ (ก)+(ค) ให้เร็วที่สุด ไม่ใช่โชว์ฟีเจอร์ครบ · big-bang 9 สาขาเสี่ยงเสียความเชื่อมั่น 9 ทีมพร้อมกันถ้า flow มีปัญหา — first impression มีครั้งเดียว
**Decision (Nutt):** Pilot ที่ **มาสด้า สำนักงานใหญ่** 1 เดือน — เหตุผล: Nutt อยู่หน้างานแก้ปัญหาได้เอง + เป็นสาขาที่มีข้อมูลวิเคราะห์จริงแล้ว (Hot lead ค้าง 33–53 วันคือ benchmark ก่อน/หลังที่วัดได้)
**Consequences:**
- mandate การเงิน (ADR-010) เริ่มบังคับเฉพาะสาขา pilot — ทดสอบเขี้ยวในสเกลเล็กก่อน
- parallel run + automated check (ADR-013) ก็เริ่มเฉพาะสาขา pilot
- cutover gate ผ่านที่ pilot → roll out สาขาถัดไปเป็นชุด (ลำดับให้ตัดสินใจตอนนั้นจากบทเรียน pilot)
- สาขาอื่นใช้ SPS เดิมตามปกติระหว่างรอ — ไม่มีอะไรพัง
- **นิยาม MVP scope:** แกนที่ต้องมีวันแรกของ pilot = person+lead+activity, SLA engine, LINE digest+quick-log เซลส์, Booking Handoff, dashboard ผจก. ขั้นต่ำ · ยังไม่ต้องมี: FB adapter (รอ Meta), quotation/finance/tradein แบบเต็ม, analytics ลึก

---

## ADR-015 — ใบเสนอราคา (Quotation): scope เฉพาะ settings ก่อน, PDF เต็มรอ SPS
**Status:** Proposed (not accepted)
**Context:** ผู้ใช้ต้องการเมนู "ใบเสนอราคา" ที่ออกเป็น PDF ได้ (fun_quotation model มีอยู่แล้วในสคีมา แต่ไม่เคยมี UI/API) — แต่การออกใบเสนอราคาจริงต้องมีข้อมูลรุ่นรถ/ราคาที่ชัดเจนซึ่งต้องดึงจากระบบ SPS เดิม (`D:\adamsps`) ซึ่งยังไม่ได้รับอนุมัติให้แตะ (เหมือน ADR-012's fresh-start policy) และ full price/variant data ยังไม่มีในระบบใหม่
**Decision (Nutt, 2026-07-08):** แบ่งงานเป็น 2 ส่วน —
1. **ทำได้ตอนนี้:** settings scaffolding เท่านั้น — ของแถม (addon) และประเภททะเบียน-ประกัน (reg_insurance) เก็บใน `fun_quote_option` (ตารางเดียว ยืดหยุ่นเพราะ field จริงยังไม่ finalize)
2. **บล็อกไว้ก่อน:** เมนู "ใบเสนอราคา" ฝั่งเซลส์, การ render PDF, และ `fun_quotation`/`fun_finance_application` API/UI — รอข้อมูลรุ่นรถ/ราคาจาก SPS (ผู้ใช้แจ้งว่าจะหาข้อมูลมาให้เพิ่ม)
**Consequences:**
- ไม่มีการดึงข้อมูลจาก SPS โดยไม่ได้รับอนุมัติชัดเจน (สอดคล้องกับ policy เดิมเรื่อง `D:\adamsps`)
- งาน settings ที่ทำตอนนี้ (ของแถม/ทะเบียน-ประกัน) จะนำกลับมาใช้ได้ทันทีเมื่อ PDF module unblock — ไม่เสียงานเปล่า
- เมนู "ใบเสนอราคา" จริงจะเพิ่มในรอบถัดไปเมื่อมีข้อมูลราคา/รุ่นรถครบ

---

## ADR-016 — Chat Response SLA: ต่อยอด SLA Engine เดิม (schema ร่างไว้ก่อน — ⏰ REMINDER: ยังไม่ได้สร้าง รอเริ่มพร้อมระบบแชทในแอป)
**Status:** Proposed (draft only — user req 2026-07-08: "ร่างไว้ก่อน แล้วเตือนให้ทำภายหลัง")
**Context:** คุยกันเรื่องระบบแชทในแอป (พนักงานตอบ LINE ผ่านหน้าเว็บแทน LINE OA Manager — ยังไม่ได้เริ่มสร้าง, ดูบทสนทนา 2026-07-08) ผู้ใช้ถามว่าจะเอามาวัดเป็น metric SLA ของการติดตามได้ไหม — คำตอบคือได้ และควร**ต่อยอดจาก SLA Engine ที่มีอยู่แล้ว** (`fun_sla_rule`/`fun_sla_event`, first-response-breach + idle ladder) ไม่ใช่สร้างระบบวัดผลแยกใหม่

**Design draft (ยังไม่ implement):**
1. `fun_chat_message` (ตารางใหม่ — ต้องมีคู่กับระบบแชทเท่านั้น สร้างไม่ได้ถ้ายังไม่มีหน้าแชท):
   ```sql
   CREATE TABLE fun_chat_message (
     message_id BIGINT AUTO_INCREMENT PRIMARY KEY,
     lead_id BIGINT NOT NULL,
     direction VARCHAR(10) NOT NULL,        -- 'inbound' | 'outbound'
     line_user_id VARCHAR(50),
     sent_by_user_id INT NULL,              -- staff ผู้ตอบ, NULL ถ้า inbound
     line_message_id VARCHAR(50) NULL,      -- LINE's own id กัน webhook ยิงซ้ำ
     body TEXT,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```
2. เพิ่มคอลัมน์ `chat_response_minutes INT NULL` ใน `fun_sla_rule` (คู่กับ `first_response_minutes` ที่มีอยู่แล้ว — ตั้งต่อ แบรนด์/สาขา/ช่องทาง/อุณหภูมิเหมือนกฎเดิม)
3. เพิ่มค่า `eventType` ใหม่ `'chat_response_breach'` ใน `fun_sla_event` — ไม่ต้อง migrate schema เพราะ `event_type` เป็น VARCHAR อยู่แล้ว (แก้ ENUM→VARCHAR ไปแล้วใน sql/006)
4. `runSlaJob()` (src/lib/jobs/sla.ts) เพิ่ม step ใหม่: หาข้อความ inbound ล่าสุดที่ยังไม่มี outbound ตอบกลับ ถ้าเกิน `chat_response_minutes` → สร้าง `fun_sla_event` แบบเดียวกับ first-response-breach ทุกอย่าง (แจ้งเตือน LINE ไปเซลส์เจ้าของ, auto-resolve เมื่อมี outbound message ใหม่กว่า detected_at)
5. ชื่อไทยที่จะใช้ในหน้า UI: **"เวลาตอบสนองแชท"** (คู่กับ "เวลาตอบสนองครั้งแรก" ที่มีอยู่แล้ว)

**Consequences:**
- ไม่มีตารางใหม่หรือโค้ดใดถูกสร้างจริงจาก ADR นี้ — เป็นแค่ blueprint ให้ทำตามได้ทันทีเมื่อเริ่มสร้างระบบแชท
- **ต้องเริ่มพร้อมกับระบบแชทในแอปเท่านั้น** — `fun_chat_message` ไม่มีประโยชน์ถ้าไม่มีหน้าแชทมาสร้างข้อมูลใส่ตาราง
- เมื่อ implement จริง ให้เพิ่ม UI แสดง "เวลาตอบสนองแชท" ที่ dashboard ผจก. และ /reports เป็น breakdown ใหม่ (เทียบ pattern เดียวกับ "เวลาตอบสนองครั้งแรก" ที่มีอยู่แล้ว)

---

## Grilling session #1 — ปิด (2026-07-06)
ประเด็นที่ตกผลึก: adoption strategy (ก+ค), Booking Handoff gate + break-glass, temperature vs ai_score, fresh-start migration, naming, parallel run + cutover gate, pilot MVP
คำถามที่ยังเปิดสำหรับ session ถัดไป (ถ้าต้องการ): ลำดับ roll out หลัง pilot · voice-to-text scope ใน MVP · เกณฑ์วัดความสำเร็จ pilot เชิงตัวเลข (เช่น Hot lead ค้างเฉลี่ยต้องลดจาก 33–53 วันเหลือเท่าไหร่)
