-- Quotation groundwork (user req 2026-07-08): full quotation PDF generation is
-- blocked pending SPS vehicle model/price data (see ADR-015 in
-- prospect2-adr-log.md), but settings scaffolding can ship now. One generic
-- lookup table (not two near-identical ones) since exact fields aren't
-- finalized yet ("ผมจะหาข้อมูลมาให้เพิ่ม") — easy to extend with more
-- option_type values later without another migration.
CREATE TABLE fun_quote_option (
  option_id INT AUTO_INCREMENT PRIMARY KEY,
  option_type VARCHAR(30) NOT NULL,      -- 'addon' | 'reg_insurance'
  option_name VARCHAR(150) NOT NULL,
  option_value DECIMAL(12,2) NULL,       -- e.g. ของแถมมูลค่า
  is_active TINYINT DEFAULT 1,
  sort_order INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
