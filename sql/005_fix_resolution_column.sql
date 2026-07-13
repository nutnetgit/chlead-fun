-- Bug fix (found 2026-07-06 building the SLA engine): fun_sla_event.resolution
-- was created as ENUM(...) in 002 but prisma/schema.prisma declares it
-- `String @db.VarChar(20)` (matches how every other "enum-ish" status column
-- in this schema is modeled — plain VARCHAR, not a Prisma enum). Writing a
-- value into the ENUM column via an UPDATE (not INSERT) threw:
--   P2032 "Error converting field resolution of expected non-nullable type
--   String, found incompatible value" — INSERT-only writes never hit this
--   because resolution is always NULL at creation time.
-- Fix: make the column match what Prisma expects. No data loss (column was
-- NULL for every row at the time of this fix).
USE ch_lead_fun;
ALTER TABLE fun_sla_event MODIFY COLUMN resolution VARCHAR(20) NULL;
