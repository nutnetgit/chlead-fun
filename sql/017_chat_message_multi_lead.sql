-- Fix (user-found bug, 2026-07-10, live test): a customer scanning two QRs
-- for two different salespeople/brands has ONE physical LINE conversation
-- but TWO active leads. The webhook was resolving inbound messages to only
-- the single most-recently-active lead, so replies always landed with
-- whichever salesperson's QR was scanned last — the other salesperson never
-- saw the customer's replies at all. Fix: log each inbound message to EVERY
-- active lead for that person, so both salespeople see it in their own
-- /chat thread (outbound stays per-lead, unaffected — whoever replies, only
-- their own thread shows their own message, which is correct).
--
-- This means the same line_message_id now legitimately appears in multiple
-- rows (one per active lead), so the old global UNIQUE on line_message_id
-- must go — retry-safety (LINE redelivering the same webhook) is now
-- handled by an explicit existence check per (lead_id, line_message_id) in
-- application code instead of a DB constraint, since a per-column unique
-- can't express "unique per lead, not globally" while lead_id is nullable
-- (NULL never equals NULL in a unique index, so a naive composite unique
-- would silently stop deduping the unresolved-sender bucket).
ALTER TABLE fun_chat_message DROP INDEX uk_line_message;
ALTER TABLE fun_chat_message ADD INDEX idx_line_message (line_message_id);
