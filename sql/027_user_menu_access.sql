-- Per-user menu access (user req 2026-07-12): which top-level menus a user
-- can open, editable per person in ตั้งค่า > ผู้ใช้และสิทธิ์. NULL = pure
-- role defaults (the behavior every existing user has today); a JSON object
-- {"menuKey": true/false, ...} overrides the role default per menu. See
-- src/lib/menuAccess.ts for the menu key registry and resolution rules.
ALTER TABLE fun_user ADD COLUMN menu_access TEXT NULL;
