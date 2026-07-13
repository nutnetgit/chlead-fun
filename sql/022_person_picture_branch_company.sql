-- Two independent additions (user req 2026-07-11):
-- 1) Customer LINE profile picture, captured at LIFF registration, shown in
--    /chat instead of the generated color-avatar when present.
-- 2) Registered juristic entity name/address per branch — stored for future
--    use on printed documents (quotations etc.), not consumed anywhere yet.
ALTER TABLE fun_person ADD COLUMN picture_url VARCHAR(500) NULL;

ALTER TABLE fun_branch
  ADD COLUMN company_name_full VARCHAR(200) NULL,
  ADD COLUMN company_address TEXT NULL;
