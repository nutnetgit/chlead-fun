-- Org structure per user feedback (2026-07-07):
--   * branches belong to a brand (สาขาแยกยี่ห้อ) → fun_branch.brand_id
--   * a user can be allowed into MULTIPLE branches, flexibly (ผจก./เซลส์แยก
--     ตามสาขา แต่ยืดหยุ่นว่าคนไหนเข้าสาขาไหนได้) → fun_user_branch junction
--     (mirrors the legacy SPS user_branch concept). fun_user.branch_id stays
--     as the "home branch".
USE ch_lead_fun;

ALTER TABLE fun_branch
  ADD COLUMN brand_id INT NULL AFTER branch_code,
  ADD CONSTRAINT fk_branch_brand FOREIGN KEY (brand_id) REFERENCES fun_brand(brand_id);

-- Backfill the 9 seeded branches from their name prefixes (Autopro = no brand).
UPDATE fun_branch b JOIN fun_brand r ON b.branch_name LIKE CONCAT(r.brand_name, '%') SET b.brand_id = r.brand_id;

CREATE TABLE IF NOT EXISTS fun_user_branch (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NOT NULL,
  branch_id INT NOT NULL,
  UNIQUE KEY uk_user_branch (user_id, branch_id),
  FOREIGN KEY (user_id) REFERENCES fun_user(user_id),
  FOREIGN KEY (branch_id) REFERENCES fun_branch(branch_id)
);
