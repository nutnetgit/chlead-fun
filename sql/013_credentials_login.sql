-- Username+password login alongside LINE Login (user request 2026-07-08).
-- Same CATS pattern: bcrypt hash, forced change on admin-issued temp password,
-- brute-force lockout. username is optional — LINE-only staff need not have one.
ALTER TABLE fun_user
  ADD COLUMN username VARCHAR(50) NULL AFTER display_name,
  ADD COLUMN password_hash VARCHAR(255) NULL AFTER username,
  ADD COLUMN must_change_password TINYINT NOT NULL DEFAULT 0 AFTER password_hash,
  ADD COLUMN failed_login_count INT NOT NULL DEFAULT 0 AFTER must_change_password,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count;

ALTER TABLE fun_user ADD UNIQUE INDEX uk_user_username (username);
