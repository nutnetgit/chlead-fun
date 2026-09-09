-- 032: Per-user × per-menu permission flags (user req 2026-09-09) — same shape
-- as the legacy SPS `user_menu` table (u_me_add/edit/cancel/del/report/viewall)
-- so the DMS team can sync either way. A row existing = the user can VIEW that
-- menu (legacy semantics: there is no separate "view" flag). No rows at all
-- for a user = fall back to the role's default matrix (src/lib/menuAccess.ts),
-- mirroring how SPS materialises a new user from user_menu_department.
--
-- Also adds fun_user.dms_user_id — the SPS `user.u_id` this account maps to,
-- used by permission import/export and as the SSO identity fallback when the
-- LINE userId is not known on one side.
--
-- Run as root inside the mariadb-erawan container (n8n_fun has no ALTER):
--   USE ch_lead_fun;

CREATE TABLE IF NOT EXISTS fun_user_menu (
  user_id     INT          NOT NULL,
  menu_key    VARCHAR(40)  NOT NULL,
  can_add     TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit    TINYINT(1)   NOT NULL DEFAULT 0,
  can_cancel  TINYINT(1)   NOT NULL DEFAULT 0,
  can_del     TINYINT(1)   NOT NULL DEFAULT 0,
  can_report  TINYINT(1)   NOT NULL DEFAULT 0,
  can_viewall TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by  INT          NULL,
  updated_at  DATETIME     NULL,
  PRIMARY KEY (user_id, menu_key),
  CONSTRAINT fk_user_menu_user FOREIGN KEY (user_id) REFERENCES fun_user(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE fun_user
  ADD COLUMN dms_user_id INT NULL AFTER line_userid,
  ADD UNIQUE KEY uk_user_dms (dms_user_id);

-- fun_user.menu_access (JSON overrides) stays for one release: the admin
-- "ย้ายสิทธิ์รูปแบบเก่า" button in /settings/users converts it into rows and
-- NULLs it. Drop it in a later migration once every row is NULL.
