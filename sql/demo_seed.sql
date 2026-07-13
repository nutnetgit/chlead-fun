-- ============================================================================
-- DEMO DATA for Ch.Lead FUN — NOT a schema migration. Safe to wipe:
-- all demo persons share created_by = 999 on fun_person rows.
-- Covers: users (admin/manager/sales, multi-branch), 12 leads across
-- brands/branches/stages/temperatures, timelines, AI drafts, SLA events,
-- lead pool, a lost lead — so every page has something to show.
-- ============================================================================
USE ch_lead_fun;

-- ── lookups ──────────────────────────────────────────────────────────────────
SET @br_mazda=(SELECT brand_id FROM fun_brand WHERE brand_name='Mazda');
SET @br_ford=(SELECT brand_id FROM fun_brand WHERE brand_name='Ford');
SET @br_gwm=(SELECT brand_id FROM fun_brand WHERE brand_name='GWM');
SET @br_deepal=(SELECT brand_id FROM fun_brand WHERE brand_name='Deepal');
SET @br_kia=(SELECT brand_id FROM fun_brand WHERE brand_name='KIA');

-- tidy the stray auto-created branch: give it its real name + brand
UPDATE fun_branch SET branch_name='Mazda นครปฐม', brand_id=@br_mazda WHERE branch_code='NPT' AND branch_name='NPT';

SET @b_hq=(SELECT branch_id FROM fun_branch WHERE branch_name='Mazda สำนักงานใหญ่');
SET @b_sala=(SELECT branch_id FROM fun_branch WHERE branch_name='Mazda ศาลายา');
SET @b_npt=(SELECT branch_id FROM fun_branch WHERE branch_code='NPT');
SET @b_ford=(SELECT branch_id FROM fun_branch WHERE branch_name='Ford อ้อมใหญ่');
SET @b_gwm=(SELECT branch_id FROM fun_branch WHERE branch_name='GWM นครปฐม');
SET @b_deepal=(SELECT branch_id FROM fun_branch WHERE branch_name='Deepal ศาลายา');
SET @b_kia=(SELECT branch_id FROM fun_branch WHERE branch_name='KIA นครปฐม');

SET @ch_walkin=(SELECT channel_id FROM fun_source_channel WHERE channel_name='Walk-in โชว์รูม' LIMIT 1);
SET @ch_phone=(SELECT channel_id FROM fun_source_channel WHERE channel_name='โทรเข้า' LIMIT 1);
SET @ch_fbads=(SELECT channel_id FROM fun_source_channel WHERE channel_name='Facebook Lead Ads' LIMIT 1);
SET @ch_event=(SELECT channel_id FROM fun_source_channel WHERE channel_name='Event / บูธ' LIMIT 1);
SET @ch_referral=(SELECT channel_id FROM fun_source_channel WHERE channel_name='ลูกค้าแนะนำ' LIMIT 1);
SET @lr_comp=(SELECT reason_id FROM fun_lost_reason WHERE reason_group='competitor' LIMIT 1);

-- ── users ────────────────────────────────────────────────────────────────────
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('สมชาย วงศ์เอราวัณ','ชาย','admin',NULL);
SET @u_admin=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('ภัทรวดี ศรีสุวรรณ','ภว','manager',@b_hq);
SET @u_mgr1=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('อนุชา พงษ์พาณิชย์','นุ','manager',@b_gwm);
SET @u_mgr2=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('วรรณนก จันทร์เพ็ญ','นก','sales',@b_hq);
SET @u_nok=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('เจนจิรา สายทอง','เจน','sales',@b_hq);
SET @u_jane=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('ต้นตระการ ยิ่งยง','ต้น','sales',@b_ford);
SET @u_ton=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('ฝนทิพย์ ชูใจ','ฝน','sales',@b_gwm);
SET @u_fon=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('บาส กีรติกร','บาส','sales',@b_kia);
SET @u_bas=LAST_INSERT_ID();
INSERT INTO fun_user (display_name, nickname, role, branch_id) VALUES ('มิณทร์ตรา พาสุข','มิ้นท์','sales',@b_deepal);
SET @u_mint=LAST_INSERT_ID();

INSERT INTO fun_user_branch (user_id, branch_id) VALUES
 (@u_mgr1,@b_hq),(@u_mgr1,@b_sala),(@u_mgr1,@b_npt),
 (@u_mgr2,@b_gwm),
 (@u_nok,@b_hq),
 (@u_jane,@b_hq),(@u_jane,@b_sala),
 (@u_ton,@b_ford),
 (@u_fon,@b_gwm),
 (@u_bas,@b_kia),
 (@u_mint,@b_deepal);

-- adopt the earlier hand-made demo lead if it exists
UPDATE fun_lead l JOIN fun_person p ON p.person_id=l.person_id SET l.owner_user_id=@u_nok WHERE p.first_name='สาธิต ระบบใหม่';

-- ── L1: HOT overdue — walk-in, Mazda CX-5, owner นก, open idle_nudge ─────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('สมหญิง','อารีวงศ์',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221001',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by,source_note) VALUES (@p,'contact_sales','any','given','demo','เซ็นฟอร์มที่โชว์รูม');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,interested_color,payment_type,buy_timeframe,stage,owner_user_id,created_at)
 VALUES (@p,@b_hq,@br_mazda,@ch_walkin,'Mazda CX-5 2.5 SP','เทา','finance','within_1m','negotiation',@u_nok,NOW()-INTERVAL 12 DAY);
SET @l1=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES (@l1,NULL,'new',NOW()-INTERVAL 12 DAY),(@l1,'new','contacted',NOW()-INTERVAL 11 DAY),(@l1,'contacted','negotiation',NOW()-INTERVAL 8 DAY);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l1,'visit_showroom','inbound','interested','Walk-in ดูรถจริง สนใจ CX-5 สีเทา ขอใบเสนอราคา',@u_nok,NOW()-INTERVAL 12 DAY),
 (@l1,'call_out','outbound','reached','โทรตามส่งใบเสนอราคาแล้ว ลูกค้าขอต่อรองส่วนลด',@u_nok,NOW()-INTERVAL 8 DAY),
 (@l1,'line_msg','outbound','line_no_read','ส่ง LINE ตามผล ยังไม่อ่าน',@u_nok,NOW()-INTERVAL 5 DAY);
UPDATE fun_lead SET temperature='hot',ai_score=88,ai_score_reason='งบชัด สนใจรุ่นเจาะจง อยู่ขั้นต่อรองราคา',
 first_response_at=NOW()-INTERVAL 11 DAY,last_activity_at=NOW()-INTERVAL 5 DAY,next_action_at=NOW()-INTERVAL 3 DAY WHERE lead_id=@l1;
INSERT INTO fun_nudge_log (lead_id,sales_user_id,trigger_type,draft_message,ai_model,pushed_at) VALUES
 (@l1,@u_nok,'followup_due','สวัสดีค่ะคุณสมหญิง นกจาก Mazda นะคะ 😊 CX-5 สีเทาที่คุณสนใจ ตอนนี้มีโปรพิเศษปลายเดือนพร้อมของแถมเพิ่มค่ะ สะดวกให้โทรสรุปราคาช่วงไหนดีคะ?','gemini-3.1-flash-lite',NOW()-INTERVAL 1 DAY);
INSERT INTO fun_sla_event (lead_id,event_type,notified_to,detected_at) VALUES (@l1,'idle_nudge',@u_nok,NOW()-INTERVAL 1 DAY);

-- ── L2: conflict demo — human ตั้ง hot แต่ AI ให้ 22 → forced warm + badge ──
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('วีรพล','ตั้งตระกูล',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221002',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,owner_user_id,created_at)
 VALUES (@p,@b_hq,@br_mazda,@ch_walkin,'Mazda 3','contacted',@u_jane,NOW()-INTERVAL 6 DAY);
SET @l2=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES (@l2,NULL,'new',NOW()-INTERVAL 6 DAY),(@l2,'new','contacted',NOW()-INTERVAL 5 DAY);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l2,'visit_showroom','inbound','considering','เดินดูรถเฉยๆ บอกว่ายังไม่รีบ',@u_jane,NOW()-INTERVAL 6 DAY),
 (@l2,'call_out','outbound','reached','โทรตาม ลูกค้าบอกขอเวลาคิด ยังไม่มีกำหนด',@u_jane,NOW()-INTERVAL 5 DAY);
UPDATE fun_lead SET temperature='warm',temperature_conflict=1,ai_score=22,ai_score_reason='ไม่มีสัญญาณความสนใจซื้อจริง ไม่มีงบ/กรอบเวลา',
 first_response_at=NOW()-INTERVAL 5 DAY,last_activity_at=NOW()-INTERVAL 5 DAY,next_action_at=NOW()+INTERVAL 2 DAY WHERE lead_id=@l2;

-- ── L3: WARM นัดวันนี้ — โทรเข้า, Mazda 2, appointment ───────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('มานพ','เจริญสุข',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221003',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,interested_color,stage,owner_user_id,created_at)
 VALUES (@p,@b_hq,@br_mazda,@ch_phone,'Mazda 2','ขาว','appointment',@u_nok,NOW()-INTERVAL 4 DAY);
SET @l3=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES (@l3,NULL,'new',NOW()-INTERVAL 4 DAY),(@l3,'new','appointment',NOW()-INTERVAL 2 DAY);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l3,'call_in','inbound','interested','โทรเข้าสอบถาม Mazda 2 มือหนึ่ง ราคาผ่อน',@u_nok,NOW()-INTERVAL 4 DAY),
 (@l3,'call_out','outbound','appointment_made','นัดเข้ามาดูรถ+ทดลองขับวันนี้ 14:00',@u_nok,NOW()-INTERVAL 2 DAY);
INSERT INTO fun_appointment (lead_id,appt_type,scheduled_at,status,notes,created_by) VALUES (@l3,'test_drive',DATE_ADD(CURDATE(), INTERVAL 14 HOUR),'confirmed','ลูกค้ายืนยันมาตามนัด',@u_nok);
UPDATE fun_lead SET temperature='warm',ai_score=64,ai_score_reason='นัดหมายแล้ว รอผลทดลองขับ',
 first_response_at=NOW()-INTERVAL 4 DAY,last_activity_at=NOW()-INTERVAL 2 DAY,next_action_at=DATE_ADD(CURDATE(), INTERVAL 14 HOUR) WHERE lead_id=@l3;
INSERT INTO fun_nudge_log (lead_id,sales_user_id,trigger_type,draft_message,ai_model,pushed_at) VALUES
 (@l3,@u_nok,'followup_due','สวัสดีครับคุณมานพ นกจาก Mazda ครับ 😊 ยืนยันนัดทดลองขับ Mazda 2 วันนี้ 14:00 นะครับ เตรียมใบขับขี่มาด้วยครับ แล้วพบกันครับ','gemini-3.1-flash-lite',NOW()-INTERVAL 3 HOUR);

-- ── L4: WARM — FB Lead Ads, CX-30, เช็คไฟแนนซ์ ──────────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('สุดา','รักดี',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221004',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by,source_note) VALUES (@p,'contact_sales','any','given','demo','FB Lead form consent');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,interested_color,payment_type,stage,owner_user_id,fb_leadgen_id,created_at)
 VALUES (@p,@b_sala,@br_mazda,@ch_fbads,'Mazda CX-30','น้ำเงิน','finance','finance_check',@u_jane,'demo_988001',NOW()-INTERVAL 7 DAY);
SET @l4=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES (@l4,NULL,'new',NOW()-INTERVAL 7 DAY),(@l4,'new','finance_check',NOW()-INTERVAL 2 DAY);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l4,'fb_msg','inbound',NULL,'ลีดใหม่จาก Facebook Lead Ads สนใจ CX-30',@u_jane,NOW()-INTERVAL 7 DAY),
 (@l4,'call_out','outbound','reached','คุยรายละเอียด ส่งเอกสารยื่นไฟแนนซ์แล้ว',@u_jane,NOW()-INTERVAL 2 DAY),
 (@l4,'finance_submitted','outbound',NULL,'ยื่น 2 ธนาคาร รอผลอนุมัติ',@u_jane,NOW()-INTERVAL 2 DAY);
INSERT INTO fun_finance_application (lead_id,financier,down_payment,term_months,monthly_est,status) VALUES (@l4,'ธนาคารกรุงศรี',150000,72,14500,'submitted');
UPDATE fun_lead SET temperature='warm',ai_score=71,ai_score_reason='ยื่นไฟแนนซ์แล้ว รอผลอนุมัติ',
 first_response_at=NOW()-INTERVAL 7 DAY,last_activity_at=NOW()-INTERVAL 2 DAY,next_action_at=NOW()+INTERVAL 2 DAY WHERE lead_id=@l4;

-- ── L5: COLD — walk-in, Mazda 3, ขอคิดดูก่อน ─────────────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('ประสิทธิ์','ทองมา',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221005',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,owner_user_id,created_at)
 VALUES (@p,@b_npt,@br_mazda,@ch_walkin,'Mazda 3','contacted',@u_jane,NOW()-INTERVAL 20 DAY);
SET @l5=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l5,'visit_showroom','inbound','considering','ดูรถ ยังไม่เลือกสี ขอคิดดูก่อน',@u_jane,NOW()-INTERVAL 20 DAY),
 (@l5,'call_out','outbound','considering','โทรตาม ยังขอเวลาตัดสินใจ',@u_jane,NOW()-INTERVAL 10 DAY);
UPDATE fun_lead SET temperature='cold',ai_score=30,ai_score_reason='ยังไม่เลือกสี ไม่มีกรอบเวลา ตอบรับเฉยๆ',
 first_response_at=NOW()-INTERVAL 19 DAY,last_activity_at=NOW()-INTERVAL 10 DAY,next_action_at=NOW()+INTERVAL 8 DAY WHERE lead_id=@l5;

-- ── L6: NEW วันนี้ — FB Lead Ads, GWM Tank 300, ยังไม่ score ─────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('กิตติ','ศรีบุญเรือง',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221006',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by,source_note) VALUES (@p,'contact_sales','any','given','demo','FB Lead form consent');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,owner_user_id,fb_leadgen_id,created_at)
 VALUES (@p,@b_gwm,@br_gwm,@ch_fbads,'GWM Tank 300','new',@u_fon,'demo_988002',NOW()-INTERVAL 2 HOUR);
SET @l6=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES (@l6,NULL,'new',NOW()-INTERVAL 2 HOUR);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_at) VALUES
 (@l6,'fb_msg','inbound',NULL,'ลีดใหม่จาก Facebook Lead Ads — สนใจ Tank 300 สอบถามโปรดาวน์',NOW()-INTERVAL 2 HOUR);
UPDATE fun_lead SET last_activity_at=NOW()-INTERVAL 2 HOUR,next_action_at=NOW() WHERE lead_id=@l6;

-- ── L7: WARM — GWM Haval H6, นัดทดลองขับพรุ่งนี้ ─────────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('อรทัย','แก้วมณี',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221007',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,owner_user_id,created_at)
 VALUES (@p,@b_gwm,@br_gwm,@ch_event,'Haval H6 HEV','test_drive',@u_fon,NOW()-INTERVAL 9 DAY);
SET @l7=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l7,'note','inbound','interested','พบที่บูธห้างเซ็นทรัล ลงชื่อสนใจ H6',@u_fon,NOW()-INTERVAL 9 DAY),
 (@l7,'call_out','outbound','appointment_made','นัดทดลองขับพรุ่งนี้ 10:30',@u_fon,NOW()-INTERVAL 1 DAY);
INSERT INTO fun_appointment (lead_id,appt_type,scheduled_at,status,created_by) VALUES (@l7,'test_drive',DATE_ADD(CURDATE(), INTERVAL 34 HOUR),'scheduled',@u_fon);
UPDATE fun_lead SET temperature='warm',ai_score=58,ai_score_reason='สนใจจากบูธ นัดทดลองขับแล้ว',
 first_response_at=NOW()-INTERVAL 8 DAY,last_activity_at=NOW()-INTERVAL 1 DAY,next_action_at=DATE_ADD(CURDATE(), INTERVAL 34 HOUR) WHERE lead_id=@l7;

-- ── L8: HOT — KIA Carnival ถึงขั้นจอง ────────────────────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('ณัฐพล','บุญส่ง',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221008',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,interested_color,payment_type,stage,owner_user_id,created_at)
 VALUES (@p,@b_kia,@br_kia,@ch_referral,'KIA Carnival','ดำ','finance','booking',@u_bas,NOW()-INTERVAL 15 DAY);
SET @l8=LAST_INSERT_ID();
INSERT INTO fun_lead_stage_history (lead_id,from_stage,to_stage,changed_at) VALUES
 (@l8,NULL,'new',NOW()-INTERVAL 15 DAY),(@l8,'new','test_drive',NOW()-INTERVAL 10 DAY),(@l8,'test_drive','negotiation',NOW()-INTERVAL 6 DAY),(@l8,'negotiation','booking',NOW()-INTERVAL 1 DAY);
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l8,'note','inbound','interested','ลูกค้าเก่าแนะนำมา สนใจ Carnival',@u_bas,NOW()-INTERVAL 15 DAY),
 (@l8,'test_drive','outbound','interested','ทดลองขับแล้ว ชอบมาก',@u_bas,NOW()-INTERVAL 10 DAY),
 (@l8,'quote_sent','outbound','interested','ส่งใบเสนอราคา + เจรจาของแถม',@u_bas,NOW()-INTERVAL 6 DAY),
 (@l8,'booking_made','outbound',NULL,'ลูกค้าตกลงจอง มัดจำ 10,000',@u_bas,NOW()-INTERVAL 1 DAY);
UPDATE fun_lead SET temperature='hot',ai_score=92,ai_score_reason='ทดลองขับแล้วพอใจ ตกลงจองแล้ว',
 first_response_at=NOW()-INTERVAL 15 DAY,last_activity_at=NOW()-INTERVAL 1 DAY,next_action_at=NOW()+INTERVAL 5 DAY WHERE lead_id=@l8;

-- ── L9: WARM — Deepal S07 negotiation + resolved exempt event ────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('พิมพ์ชนก','วัฒนกุล',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221009',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,owner_user_id,created_at)
 VALUES (@p,@b_deepal,@br_deepal,@ch_walkin,'Deepal S07','negotiation',@u_mint,NOW()-INTERVAL 18 DAY);
SET @l9=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l9,'visit_showroom','inbound','interested','ดูรถ S07 เทียบกับคู่แข่ง',@u_mint,NOW()-INTERVAL 18 DAY),
 (@l9,'call_out','outbound','considering','ต่อรองราคา รอโปรใหม่เดือนหน้า',@u_mint,NOW()-INTERVAL 12 DAY),
 (@l9,'sla_override','internal',NULL,'ผจก. ยกเว้น SLA breach',@u_mgr2,NOW()-INTERVAL 3 DAY);
INSERT INTO fun_sla_event (lead_id,event_type,notified_to,detected_at,resolved_at,resolution,exempted_by) VALUES
 (@l9,'idle_escalate',@u_mint,NOW()-INTERVAL 4 DAY,NOW()-INTERVAL 3 DAY,'exempted',@u_mgr2);
UPDATE fun_lead SET temperature='warm',ai_score=55,ai_score_reason='รอโปรเดือนหน้า ตั้งใจซื้อแต่ยังไม่รีบ',
 first_response_at=NOW()-INTERVAL 17 DAY,last_activity_at=NOW()-INTERVAL 3 DAY,next_action_at=NOW()+INTERVAL 12 DAY WHERE lead_id=@l9;

-- ── L10: HOT overdue หนัก — Ford Ranger, open idle_escalate ──────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('ธนกร','พูลสวัสดิ์',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221010',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,payment_type,buy_timeframe,stage,owner_user_id,created_at)
 VALUES (@p,@b_ford,@br_ford,@ch_phone,'Ford Ranger Wildtrak','cash','within_1m','qualified',@u_ton,NOW()-INTERVAL 16 DAY);
SET @l10=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l10,'call_in','inbound','interested','โทรเข้า สนใจ Ranger Wildtrak ซื้อสด ใช้งานธุรกิจ',@u_ton,NOW()-INTERVAL 16 DAY),
 (@l10,'call_out','outbound','reached','ส่งสเปค+ราคาแล้ว บอกจะเข้ามาดูรถ',@u_ton,NOW()-INTERVAL 15 DAY);
UPDATE fun_lead SET temperature='hot',ai_score=79,ai_score_reason='ซื้อสด กรอบเวลาชัด แต่ขาดการติดตามนาน',
 first_response_at=NOW()-INTERVAL 16 DAY,last_activity_at=NOW()-INTERVAL 15 DAY,next_action_at=NOW()-INTERVAL 9 DAY WHERE lead_id=@l10;
INSERT INTO fun_sla_event (lead_id,event_type,notified_to,detected_at) VALUES
 (@l10,'idle_nudge',@u_ton,NOW()-INTERVAL 7 DAY),(@l10,'idle_escalate',@u_ton,NOW()-INTERVAL 1 DAY);
INSERT INTO fun_nudge_log (lead_id,sales_user_id,trigger_type,draft_message,ai_model,pushed_at) VALUES
 (@l10,@u_ton,'idle_warning','สวัสดีครับคุณธนกร ต้นจาก Ford ครับ 🙏 Ranger Wildtrak ที่สอบถามไว้ ตอนนี้มีรถพร้อมส่งและข้อเสนอพิเศษสำหรับลูกค้าเงินสดครับ สะดวกแวะเข้ามาดูรถช่วงไหนดีครับ?','gemini-3.1-flash-lite',NOW()-INTERVAL 7 DAY);

-- ── L11: ถูกริบเข้า pool — Mazda CX-5 hot ไร้เจ้าของ ─────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('ศิริพร','คงคา',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221011',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,status,owner_user_id,created_at)
 VALUES (@p,@b_hq,@br_mazda,@ch_fbads,'Mazda CX-5','forfeited','forfeited',NULL,NOW()-INTERVAL 30 DAY);
SET @l11=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_at) VALUES
 (@l11,'fb_msg','inbound',NULL,'ลีดจาก Facebook Lead Ads',NOW()-INTERVAL 30 DAY);
UPDATE fun_lead SET temperature='hot',ai_score=75,ai_score_reason='เคย hot แต่ถูกปล่อยจนถูกริบ',
 last_activity_at=NOW()-INTERVAL 25 DAY,next_action_at=NOW()-INTERVAL 22 DAY WHERE lead_id=@l11;
INSERT INTO fun_sla_event (lead_id,event_type,detected_at,resolved_at,resolution) VALUES
 (@l11,'idle_nudge',NOW()-INTERVAL 17 DAY,NOW()-INTERVAL 5 DAY,'returned_to_pool'),
 (@l11,'idle_escalate',NOW()-INTERVAL 11 DAY,NOW()-INTERVAL 5 DAY,'returned_to_pool');
INSERT INTO fun_sla_event (lead_id,event_type,detected_at) VALUES (@l11,'idle_forfeit',NOW()-INTERVAL 5 DAY);
INSERT INTO fun_lead_pool (lead_id,entered_at,entered_reason,priority) VALUES (@l11,NOW()-INTERVAL 5 DAY,'forfeited',2);
INSERT INTO fun_assignment_history (lead_id,from_user_id,to_user_id,reason,assigned_at) VALUES (@l11,@u_jane,NULL,'forfeit_reassign',NOW()-INTERVAL 5 DAY);

-- ── L12: LOST — KIA Sportage แพ้คู่แข่ง ──────────────────────────────────────
INSERT INTO fun_person (first_name,last_name,created_by) VALUES ('เดชา','ไชยวงศ์',999);
SET @p=LAST_INSERT_ID();
INSERT INTO fun_person_identifier (person_id,id_type,id_value,is_primary) VALUES (@p,'phone','0812221012',1);
INSERT INTO fun_person_consent (person_id,purpose,channel,status,recorded_by) VALUES (@p,'contact_sales','any','given','demo');
INSERT INTO fun_lead (person_id,branch_id,brand_id,channel_id,interested_variant,stage,status,lost_reason_id,owner_user_id,created_at)
 VALUES (@p,@b_kia,@br_kia,@ch_walkin,'KIA Sportage','lost','lost',@lr_comp,@u_bas,NOW()-INTERVAL 25 DAY);
SET @l12=LAST_INSERT_ID();
INSERT INTO fun_activity (lead_id,activity_type,direction,outcome,summary,created_by,created_at) VALUES
 (@l12,'visit_showroom','inbound','interested','ดู Sportage เทียบ Haval H6',@u_bas,NOW()-INTERVAL 25 DAY),
 (@l12,'call_out','outbound','not_interested','ลูกค้าแจ้งซื้อคู่แข่งแล้ว (โปรแรงกว่า)',@u_bas,NOW()-INTERVAL 8 DAY);
UPDATE fun_lead SET temperature='warm',ai_score=45,first_response_at=NOW()-INTERVAL 24 DAY,last_activity_at=NOW()-INTERVAL 8 DAY WHERE lead_id=@l12;

SELECT CONCAT('DEMO SEEDED: users=',(SELECT COUNT(*) FROM fun_user),' persons=',(SELECT COUNT(*) FROM fun_person),' leads=',(SELECT COUNT(*) FROM fun_lead),' activities=',(SELECT COUNT(*) FROM fun_activity),' sla_events=',(SELECT COUNT(*) FROM fun_sla_event),' pool=',(SELECT COUNT(*) FROM fun_lead_pool WHERE claimed_at IS NULL)) AS result;
