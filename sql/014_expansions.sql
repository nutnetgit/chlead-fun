-- Batch 2026-07-08: settings expansions.
-- 1) fun_user.phone — needed for the LINE OA welcome push to introduce the
--    salesperson ("เซลล์ [nickname] เบอร์ [phone]") to a customer who just
--    added the OA via QR/LIFF.
-- 2) fun_source_channel: responsible_person + budget — matches the legacy
--    Prospect system's richer Online/Showroom channel fields (ผู้ดูแล/งบรวม).
-- 3) fun_campaign.line_promo_message — manager-settable text pushed to a
--    customer via LINE OA when they follow through an event-type QR.
ALTER TABLE fun_user
  ADD COLUMN phone VARCHAR(20) NULL AFTER nickname;

ALTER TABLE fun_source_channel
  ADD COLUMN responsible_person VARCHAR(100) NULL AFTER channel_name,
  ADD COLUMN budget DECIMAL(12,2) NULL AFTER responsible_person;

ALTER TABLE fun_campaign
  ADD COLUMN line_promo_message TEXT NULL;
