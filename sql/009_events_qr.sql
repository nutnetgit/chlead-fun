-- Events (manager-configured) + QR self-intake support (user reqs 2026-07-07).
-- Events reuse fun_campaign as the base record; two junctions add what the
-- schema doc's campaign lacked: brands attending, and per-salesperson lead
-- allocation targets (for event metrics: actual leads vs target).
USE ch_lead_fun;

ALTER TABLE fun_campaign ADD COLUMN target_leads INT NULL;

CREATE TABLE IF NOT EXISTS fun_campaign_brand (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  brand_id    INT NOT NULL,
  UNIQUE KEY uk_campaign_brand (campaign_id, brand_id),
  FOREIGN KEY (campaign_id) REFERENCES fun_campaign(campaign_id),
  FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id)
);

CREATE TABLE IF NOT EXISTS fun_campaign_target (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id  INT NOT NULL,
  user_id      INT NOT NULL,
  target_leads INT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_campaign_user (campaign_id, user_id),
  FOREIGN KEY (campaign_id) REFERENCES fun_campaign(campaign_id),
  FOREIGN KEY (user_id) REFERENCES fun_user(user_id)
);
