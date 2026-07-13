-- Quotation feature build-out (user req 2026-07-11): per-quote line items +
-- the fields the create-form needs. fun_quotation itself existed since
-- sql/002 but had no UI/API until now.
--
--  * fun_quotation_item: one row per selected option on a quote, with a
--    SNAPSHOT of the name/value at quote time (master rows in
--    fun_quote_option can be renamed/deleted later without corrupting
--    history). is_free: 1 = ของแถม (no charge), 0 = ซื้อ (added to total).
--  * payment_type: 'cash' | 'finance' | NULL (undecided) — plain VARCHAR to
--    match the enum→varchar convention from sql/006.
--  * color_price_adjust / deposit_amount: pricing fields the total needs.
--  * share_token: unguessable id for the customer-facing PDF link pushed
--    over LINE — the customer opens it without logging in, so the URL must
--    not be enumerable (quote_id alone would be).
ALTER TABLE fun_quotation
  ADD COLUMN payment_type VARCHAR(15) NULL,
  ADD COLUMN color_price_adjust DECIMAL(12,2) NULL,
  ADD COLUMN deposit_amount DECIMAL(12,2) NULL,
  ADD COLUMN share_token VARCHAR(40) NULL UNIQUE,
  ADD COLUMN sent_at DATETIME NULL;

CREATE TABLE fun_quotation_item (
  item_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  quote_id BIGINT NOT NULL,
  option_type VARCHAR(30) NOT NULL,
  item_name VARCHAR(150) NOT NULL,
  item_value DECIMAL(12,2) NULL,
  is_free TINYINT DEFAULT 0,
  FOREIGN KEY (quote_id) REFERENCES fun_quotation(quote_id),
  INDEX idx_qitem (quote_id)
);
