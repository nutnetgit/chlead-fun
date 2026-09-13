# Task #35 Recap: SPS integration groundwork, permissions/audit/SSO, catalogue sync, security review

**Period:** 2026-09-09 → 2026-09-13 (one long session)
**Status:** ✅ ALL CODE DEPLOYED. Production runs image `592ad2c23bb1` = commit `4d5af14`; migrations `032`–`036` applied. What is still open is configuration and work on other teams' side — see §10.

**Live at:** https://fun.ch-erawan.com · **GitHub:** github.com/nutnetgit/chlead-fun (master)

---

## 1. Channels split out of the admin settings menu — `d8f6c49`

The Channels page (Facebook Page → brand/branch routing) had been gated by the same menu key as user management, so giving someone channel access also gave them the power to create users. It now has its own menu key `settings-channels`. This mattered immediately for the Meta App Review test user.

Also: the Channels page placeholder no longer names a specific branch ("Mazda ช.เอราวัณ" only).

## 2. Meta App Review — approved and published

Walked through test-user setup, reviewer instructions and the screencast. The app was approved and published. The Facebook Page "คลับรักรถมาสด้า โดย ช.เอราวัณ Mazda Ch.Erawan" (id `152310698161655`) was subscribed to the `leadgen` field through the Graph API using the System User "cherawanBot" token exchanged for a Page token. Lead Ads Instant Forms were explained but not yet exercised end to end.

## 3. Six-flag permissions, audit log, SPS SSO — `bb910b5` (sql/032–034)

- **Permissions** now mirror SPS's legacy `user_menu`: one `fun_user_menu` row per user × menu with `add/edit/cancel/del/report/viewall`; no rows = role defaults that reproduce the old behaviour exactly. `requirePerm(menu, flag)` on every write/export route; admin never gated; `viewall` lifts branch/owner scoping. `/settings/users` got the flag grid, "copy permissions from user", the SPS user id field and a one-time migration button. `GET /api/permissions/export` / `POST /api/permissions/import` exist for the DMS team.
- **Audit log** `fun_audit_log` via `audit()` in `src/lib/audit.ts`: actor, IP, user agent, request id, before/after diff, result; secrets stripped, phones masked; `/logs` → Audit tab with CSV; nightly retention purge.
- **SSO both directions** with opaque single-use 60-second tickets (hashed in `fun_sso_ticket`): out = `POST /api/sso/handoff` from a booked lead → SPS landing page → SPS calls `POST /api/sso/verify`; in = SPS calls `POST /api/sso/issue` → `/sso?ticket=` → NextAuth provider `sso`. Identity join `line_userid` then `dms_user_id`.

## 4. Branch UI: built CPT-style, then simplified — `f0408c9`, `41caef8`, `1b80f25`, `91c20c8`

Built CPT's branch picker, a header working-branch switcher and a "switch to another Ch.Erawan system" section in the user menu. The owner then pointed out the lists already split by brand chips and a branch row is brand × location, so the header switcher only changed one thing (the add-lead default) while looking like a filter that did nothing to the lists. **Removed it:** the header shows a read-only branch badge, the per-page "ทุกสาขา" picker stays the single branch control, and the add-lead form remembers the last branch used (localStorage). The working-branch cookie and `POST /api/me/branch` were kept for future SPS use. The system switcher in the user menu stayed.

## 5. Handoff carries the lead's branch, because SPS switches brand by branch — `c8eccd4` (sql/035)

Reading `sps/login.php` and `sps/booking_form.php` showed SPS has **no** brand or company context: its only tenancy dimension is the branch, and the brand is derived from `branch.sto_br_id`. Its own branch menu is just `login.php?branch=<id>`.

- Added `fun_branch.dms_branch_id` and `fun_brand.dms_brand_id`, editable in `/settings/branches` (brand id via the chain icon on each brand chip).
- The verify payload now carries `lead.sps { program, branch_id, sto_br_id, brand_desc }`.
- `/api/sso/handoff` refuses a lead whose branch is not mapped instead of opening a booking in the wrong showroom.
- **Corrected the DMS handover:** the earlier doc told SPS to pass our `handoff_id` as `pros_id`, which was wrong. `booking_form.php` re-reads branch and brand from the `prospectcontact` row at save time, so SPS must create its own prospect in that branch and hop through `login.php?program=sales system&branch=…&goto_sps_booking=yes…` (a path that already exists in `pros_form2.php`).

Mapping filled in by the owner: all 9 branches and all 8 brands. Three branch names do not match the SPS dump exactly and await confirmation (listed in `docs/STATUS.md`).

## 6. SPS vehicle catalogue mirrored into Ch.Lead FUN — `513b979` (sql/036)

SPS owns models and colours and has no API for them (only unauthenticated autocomplete files returning HTML), so Ch.Lead FUN reads SPS's MySQL with a SELECT-only account, exactly as CPT already does. The owner chose to mirror only nameplate → colour, not variants or prices.

- `src/lib/dms/reader.ts` (SELECT only, rule stated in the file header) reads `stock_model_main`, `stock_model` (only to decide which nameplates still have a live variant), and `stock_color`.
- `src/lib/jobs/dmsCatalogSync.ts` runs at the 02:00 tick and from a "sync now" card on `/settings/models`. Matching by `dms_model_id` / `dms_color_id`, adopting hand-typed rows by name on the first run. Retired items are deactivated, never deleted. Mirrored rows are tagged "จาก SPS" and are read-only in the settings UI and API.
- Colour names: `sto_co_desc_th` when present, otherwise the part of `sto_co_desc` before "(" (SPS does the same); manufacturer code kept in `color_code`.
- Off until `DMS_MYSQL_URL` is set; brands without an SPS id are skipped.

## 7. Handover package and status note — `e081032`, `78eb1b2`, `fb345f7`, `60de84d`

- `docs/SPS_INTEGRATION.md` gained §0 (who does what, in three tracks that do not block each other: catalogue sync, identity mapping, SSO), §5 catalogue sync, §7 every env var with what happens when empty plus the two network paths, §8 status on handover day and the caveats found in SPS's source, §9 paste-ready curl tests.
- `docs/STATUS.md` created as the entry point for any new session — especially a cloud session, which sees only the repo.

## 8. Security review and fixes — `4d5af14`

Findings, in severity order, and what was done:

1. **Credentials in the repo** — database password in `docker-compose.yml` / `.env.example`, and (found during this recap) also the root password and an admin temp password in `PROJECT_CONTEXT.md`, older recaps and `n8n/README-WF1.md`. Scrubbed from the current files on 2026-09-13; **still in git history, so rotation is required** (owner action).
2. **Auth failed open** when LINE Login env vars were empty, handing out admin rights. Now on unless `AUTH_DISABLED=1`, which compose does not pass. Job and ingest endpoints now refuse when `WEBHOOK_SECRET` is unset, compared timing-safe (`src/lib/apiKey.ts`).
3. **Public lead intake had no rate limit** although each accepted call can send a paid LINE push. Added `src/lib/rateLimit.ts`: 30/hour per IP, 5/hour per phone, welcome push 3/hour per lead. Confirmed real client IPs reach the app through the tunnel before relying on per-IP buckets.
4. **Managers could open any lead by id** across branches. `requireLeadAccess` now scopes managers too.
5. **Staff directory leaked** phones, LINE ids, usernames and permission matrices to every sales user. Sensitive fields now manager+ only.
6. **Public path matching by bare prefix** exempted the model/brand write routes from the session gate. Now boundary matching, and those trees are public for reads only.
7. **Welcome-push signature never expired** and fell back to the literal secret "dev". Now carries a deadline and refuses to sign without a real secret.

Verified after deploy with unauthenticated probes: public reads 200, protected writes and reads 401, job endpoints 401 without or with a wrong key, customer pages still 200, protected pages redirect to login.

Confirmed fine: LINE/Meta signature verification, quote share tokens (128-bit random), login lockout, bcrypt, no raw SQL interpolation, no `dangerouslySetInnerHTML`, SSO refusing everything while its token is unset.

## 9. Working-environment findings

- The owner's terminal is Windows PowerShell 5.1 — `&&` fails; use `;`.
- A cloud Claude Code session cannot reach the NAS, the production DB, `D:\adamsps` or the CPT project. Keep deploy work local.
- Remote Control is enabled by a button in the Claude desktop app on the existing session; the CLI flag route started sessions the phone never saw. This conversation was continued from the phone that way.
- Production can be inspected read-only without touching a password by piping a Node script into `docker exec -i fun-app node`.
- All of this, plus every earlier memory note, is now consolidated in `PROJECT_CONTEXT.md` §6.

## 10. Outstanding / carried forward

| Item | Blocked on | Effect today |
|---|---|---|
| Rotate the leaked DB password(s) and admin temp password; move `DATABASE_URL` out of `docker-compose.yml` | Owner | Anyone with repo history access has them |
| SELECT-only MySQL account on `adam_prod` → `DMS_MYSQL_URL` | IT | Catalogue sync off; models/colours are hand-maintained |
| `sso_land.php`, SPS menu link, prospect creation on handoff | DMS team | "เปิดใบจองใน SPS" button hidden; bookings keyed into SPS by hand |
| `SSO_API_TOKEN`, `SPS_SSO_LANDING_URL` on the NAS | After the item above | SSO endpoints refuse everything (safe) |
| `dms_user_id` for each user | User list from DMS team | SSO can still match on `line_userid` |
| Confirm 3 branch mappings (Mazda นครปฐม→1, KIA สามพราน→9, GAC นครปฐม→11) | Owner, against live SPS | Handoff for those branches may land in the wrong SPS branch |
| Persist `chgrp docker /var/run/docker.sock` across NAS reboots (DSM boot task) | Owner | After a reboot, remote docker commands fail until re-run |
| Chat response SLA (ADR-016) | Owner decision | Deferred by choice |
