-- Customer-consent ownership switch (user req 2026-07-10): when a customer
-- already assigned to salesperson A scans salesperson B's QR for the SAME
-- brand, the system does NOT reassign silently. It asks the customer via a
-- LINE Flex message with 2 buttons ("stay with A" / "switch to B") and only
-- reassigns on their explicit choice — default (no answer) stays with A,
-- since the lead's owner_user_id is never touched until the customer taps.
CREATE TABLE fun_owner_switch_request (
  request_id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  current_owner_id INT NOT NULL,
  offered_owner_id INT NOT NULL,
  status VARCHAR(15) NOT NULL DEFAULT 'pending', -- pending | kept | switched
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  INDEX idx_switch_lead (lead_id)
);
