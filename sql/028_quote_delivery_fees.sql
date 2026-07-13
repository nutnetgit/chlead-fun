-- Itemized "cash to prepare on delivery day" fields for quotations (user
-- req 2026-07-13, inspired by a competing dealer's PDF layout — own schema/
-- style, not copied). Previously these were either absent or folded into
-- accessories_value with no line of their own.
ALTER TABLE fun_quotation
  ADD COLUMN registration_fee DECIMAL(12,2) NULL AFTER accessories_value,
  ADD COLUMN compulsory_insurance DECIMAL(12,2) NULL AFTER registration_fee,
  ADD COLUMN first_installment DECIMAL(12,2) NULL AFTER compulsory_insurance;
