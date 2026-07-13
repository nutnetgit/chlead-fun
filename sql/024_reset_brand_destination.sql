-- Every `destination` value saved so far came from the old (flawed) manual
-- entry flow — either the LINE Login channel's "Your user ID" (the admin's
-- own personal ID, same for every channel) or otherwise unverified. None of
-- it is trustworthy. Reset to NULL so the new auto-detect mechanism
-- (src/lib/lineConfig.ts resolveLineCreds — matches the webhook signature
-- against each brand's Channel Secret on first contact) learns the real
-- value cleanly for every brand.
UPDATE fun_brand_line_config SET destination = NULL;
