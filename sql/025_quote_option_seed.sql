-- Starter option list for fun_quote_option (user req 2026-07-11) — the
-- common accessory/fee items a dealership quotes day to day, grouped by
-- category for /settings/quotation-options. Not final: Nutt revises the
-- list in that page himself. Values are mostly NULL on purpose — actual
-- prices vary per deal/campaign and get typed in per quote; only
-- ค่าจดทะเบียน/ค่ามัดจำป้ายแดง carry current known defaults (3,500 / 3,000).
-- Run once — re-running duplicates rows (option_name isn't unique).

-- อุปกรณ์เสริม (addon)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('addon','กรอบป้ายทะเบียน',1),
 ('addon','กล้องหน้ารถ',2),
 ('addon','กล้องมองหลัง',3),
 ('addon','แผ่นกันความร้อนใต้ฝากระโปรงหน้า',4),
 ('addon','แผงบังแดด',5),
 ('addon','พรมปูพื้นห้องโดยสาร',6),
 ('addon','ยางปูพื้นห้องโดยสาร',7),
 ('addon','ชุดฟิล์มกันรอยสำหรับชิ้นส่วนเปียโนแบล็ก (ภายใน)',8),
 ('addon','ชุดฟิล์มกันรอยสำหรับชิ้นส่วนเปียโนแบล็ก (ภายนอก)',9),
 ('addon','ชุดสัญญาณถอยหลัง 2 จุด',10),
 ('addon','ชุดสัญญาณถอยหลัง 4 จุด',11),
 ('addon','เซ็นเซอร์-หน้า',12),
 ('addon','ถาดใส่ของท้ายรถ (4 ประตู)',13),
 ('addon','ถาดใส่ของท้ายรถ (5 ประตู)',14),
 ('addon','ชุดแผ่นกันกระแทกท้ายรถ',15),
 ('addon','ชุดตาข่ายกั้นสัมภาระ',16),
 ('addon','ชุดกุญแจล็อคล้ออะไหล่',17),
 ('addon','ซองใส่รีโมท',18),
 ('addon','ผ้าคลุมรถ',19),
 ('addon','ชุดอุปกรณ์ฉุกเฉิน',20),
 ('addon','ชุดเชื่อมต่อสมาร์ทโฟน (Apple CarPlay)',21),
 ('addon','จอ Android',22);

-- อุปกรณ์ตกแต่งภายนอก (decor_exterior)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('decor_exterior','ชุดไฟตัดหมอก',1),
 ('decor_exterior','ฟิล์มติดรถยนต์',2),
 ('decor_exterior','กระจังหน้า',3),
 ('decor_exterior','ชุดเสริมกันชนหน้า',4),
 ('decor_exterior','ชุดสเกิร์ตหน้า',5),
 ('decor_exterior','ชุดสเกิร์ตข้าง',6),
 ('decor_exterior','ชุดสเกิร์ตหลัง',7),
 ('decor_exterior','สเกิร์ตหลัง (5 ประตู) สำหรับรุ่นมีเซนเซอร์กะระยะด้านหลัง',8),
 ('decor_exterior','สเกิร์ตหลัง (5 ประตู) สำหรับรุ่นที่ไม่มีเซนเซอร์กะระยะด้านหลัง',9),
 ('decor_exterior','ชุดครอบไฟหน้า',10),
 ('decor_exterior','ชุดครอบไฟท้าย',11),
 ('decor_exterior','ฝาครอบกระจกมองข้าง',12),
 ('decor_exterior','ชุดคิ้วขอบประตู-หน้า (Scuff Plate)',13),
 ('decor_exterior','ชุดคิ้วขอบประตู-หลัง (Scuff Plate)',14),
 ('decor_exterior','คิ้วกันรอยกันชนหลัง',15),
 ('decor_exterior','ชุดคิ้วกันชนหน้า',16),
 ('decor_exterior','ชุดคิ้วกันชนหลัง',17),
 ('decor_exterior','ชุดคิ้วกันชนข้าง',18),
 ('decor_exterior','คิ้วตกแต่งซุ้มล้อ',19),
 ('decor_exterior','ล้ออัลลอยสีดำ',20),
 ('decor_exterior','ฝาครอบล้อ',21),
 ('decor_exterior','บังโคลน (คู่หน้า)',22),
 ('decor_exterior','แผงกันแมลงฝากระโปรงหน้า',23),
 ('decor_exterior','ชุดคิ้วกันสาด',24),
 ('decor_exterior','ชุดซุ้มล้อ',25),
 ('decor_exterior','บันไดข้าง',26),
 ('decor_exterior','แผ่นกันรอยข้างประตู',27),
 ('decor_exterior','แป้นเหยียบสปอร์ต',28),
 ('decor_exterior','กรอบรองที่จับมือเปิดประตูโครเมียม',29),
 ('decor_exterior','ชุดสไตลิ่งบาร์',30),
 ('decor_exterior','ชุดสปอยเลอร์หลังแบบสปอร์ต รุ่น 5 ประตู',31),
 ('decor_exterior','สปอยเลอร์หลัง (4 ประตู)',32),
 ('decor_exterior','สปอยเลอร์เสริมหลังคาหลัง (5 ประตู)',33),
 ('decor_exterior','กันชนท้าย',34),
 ('decor_exterior','บังโคลน (คู่หลัง)',35),
 ('decor_exterior','แร็คหลังคา',36),
 ('decor_exterior','พื้นปูกระบะ+ห่วงยึด',37),
 ('decor_exterior','ปลายท่อไอเสีย',38),
 ('decor_exterior','ฝาครอบถังน้ำมัน',39),
 ('decor_exterior','สติกเกอร์ข้างตัวรถ',40);

-- อุปกรณ์ตกแต่งภายใน (decor_interior)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('decor_interior','ชุดไฟส่องสว่างพื้นรถ',1),
 ('decor_interior','ชุดผ่อนแรงเปิด-ปิด ฝากระบะท้าย',2),
 ('decor_interior','เบาะแค็ป',3);

-- อุปกรณ์อิเล็กทรอนิกส์ (decor_electronics)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('decor_electronics','กล้องบันทึกหน้ารถ',1),
 ('decor_electronics','ชุดเซ็นเซอร์เท้าควบคุมการเปิด-ปิดประตูท้าย',2),
 ('decor_electronics','ชุดพับกระจกมองข้างอัตโนมัติ',3),
 ('decor_electronics','กล้องบันทึกหน้ารถ-หลังรถ',4);

-- ชุดแต่ง / แพ็กเกจ (decor_other)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('decor_other','ชุดแต่งสตาทเตอร์ (Starter Pack)',1),
 ('decor_other','ชุดแต่งไลฟ์สไตล์ (Active Lifestyle)',2),
 ('decor_other','ชุดแต่งพรีเมี่ยม (Premium Selection)',3),
 ('decor_other','ชุดแต่ง Signature Style Acc Kit',4),
 ('decor_other','ชุดแต่ง Kensho Body Kit Set (5FB)',5),
 ('decor_other','ชุดแต่ง Kensho Sedan Body Kit Set (4SD)',6);

-- ประเภททะเบียน-ประกัน / ข้อเสนอพิเศษวันรับรถ (reg_insurance) — 2 รายการมีมูลค่า
-- จริงที่สังเกตได้จากใบเสนอราคาตัวอย่าง ที่เหลือปล่อย NULL ให้กรอกเอง
INSERT INTO fun_quote_option (option_type, option_name, option_value, sort_order) VALUES
 ('reg_insurance','ค่า พ.ร.บ.',NULL,1),
 ('reg_insurance','ค่าจดทะเบียน',3500.00,2),
 ('reg_insurance','ค่ามัดจำป้ายแดง',3000.00,3),
 ('reg_insurance','ค่าใช้จ่ายอื่นๆ ในวันรับรถ',NULL,4);

-- ข้อเสนอพิเศษอื่นๆ (special_offer)
INSERT INTO fun_quote_option (option_type, option_name, sort_order) VALUES
 ('special_offer','เติมน้ำมันเต็มถัง',1),
 ('special_offer','ขัดเคลือบสีรถ',2),
 ('special_offer','เคลือบแก้ว',3),
 ('special_offer','ส่วนลดค่าแรงเช็คระยะ (ลูกค้า VIP)',4),
 ('special_offer','แผนที่นำทางเนวิเกเตอร์เชื่อมต่อระบบ (MZD Connect)',5);

SELECT CONCAT('quote_options=', (SELECT COUNT(*) FROM fun_quote_option)) AS result;
