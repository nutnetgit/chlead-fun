-- 030: chat-extract watermark (user req 2026-07-15 — "auto-tag จากบทสนทนา").
-- The hourly chat-extract job (src/lib/jobs/chatExtract.ts) re-scores a lead
-- and fills blank structured fields from its LINE chat transcript. This
-- column records the created_at of the newest chat message already analyzed,
-- so each hourly pass only picks up leads with inbound messages NEWER than
-- this (NULL = never analyzed → candidate as soon as any inbound chat exists).
ALTER TABLE fun_lead ADD COLUMN chat_analyzed_at DATETIME NULL;
