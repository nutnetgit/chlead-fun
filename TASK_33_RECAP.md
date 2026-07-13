# Task #33 Recap: Weighted Pipeline, Per-brand LINE OA, Quotation feature, Per-user menu access

**Status:** Mostly ✅ DEPLOYED — one small batch (Flex/PDF wording polish, §7) built+typechecked but **NOT YET deployed** at session end (context ran out before user confirmed). See §8 for exact next steps.

**Live at:** https://fun.ch-erawan.com

---

## 1. Weighted Pipeline forecast (deployed)

- **Lead Aging auto-downgrade**: `runSlaJob()` (`src/lib/jobs/sla.ts`) now downgrades a HOT lead idle past `hotAgingDays` (from `/settings/conversion-rates`) to WARM before the rest of that hourly pass runs, logged as a `fun_activity` "note" row. Legacy `/settings/conversion-rates` groundwork from Task #32 is now actually wired in.
- **Weighted Pipeline card** on `/runrate`: `Σ(active leads per tier × that tier's configured probability)`, shown alongside the existing 90-day-CR forecast.
- No schema changes.

---

## 2. Per-brand LINE OA (deployed, evolved significantly mid-session)

**Final design** (corrected twice from earlier attempts — see the "false starts" note below):
- Table `fun_brand_line_config` (1:1 with `fun_brand`): `destination` (LINE's bot userId), `channel_access_token` (TEXT, not VARCHAR — widened after a real bug, see below), `channel_secret`, `liff_id`, `is_active`.
- **`destination` is auto-detected, not manually entered.** LINE's console does NOT expose a copyable "Bot user ID" field anywhere (confirmed live by the user pasting the actual Messaging API settings page) — the earlier design assumption was wrong. `src/lib/lineConfig.ts`'s `resolveLineCreds(raw, signatureHeader, destination)` first tries a fast-path lookup by `destination`, then on a cold start tries the webhook's HMAC signature against every configured brand's `channel_secret` — the first match IS the right brand, and its `destination` gets persisted for next time. `/settings/line-oa` now only asks for **Channel Access Token + Channel Secret**, nothing else.
- **False starts worth knowing about** (in case old comments/instincts point back here): the settings page briefly required a manual "Bot User ID" / "Your user ID" field — first mislabeled (confused with the LINE LOGIN channel's "Your user ID", which is the admin's own personal ID, identical across every channel — NOT a per-bot value), then discovered to not exist in the console at all. Don't reintroduce manual `destination` entry.
- Per-brand LIFF IDs are filled in (`/settings/line-oa`'s second card) for all 8 brands: Mazda, Ford, Mitsubishi, GWM, Deepal, KIA, Lepas, GAC — user provided the actual LIFF IDs live.
- **`/liff/register` and `QrLeadModal.tsx`** resolve LIFF ID per-brand from `/api/brands` (now includes `liffId`, public/non-secret) instead of the single shared `NEXT_PUBLIC_LIFF_ID`.
- Brand display order (settings page + anywhere brand lists render) follows a fixed priority list: Mazda, Ford, Mitsubishi, GWM, Deepal, KIA, GAC, Lepas — not alphabetical.
- New brands GAC and Lepas added to `fun_brand`; sample vehicle models seeded (`sql/021`) — GAC models are real (AION Y Plus, AION V, Empow, GS3 Emzoom, M8, GS8), **Lepas models are generic placeholders** ("Model 1/2/3" — real lineup unknown, flagged to Nutt to correct via `/settings/models`).
- `fun_branch` gained `company_name_full` / `company_address` (per-branch registered entity info, editable in `/settings/branches`) — used by the quotation PDF's masthead.
- `fun_person` gained `picture_url` — captured from `liff.getProfile().pictureUrl` at registration, shown in `/chat` (new `Avatar` component, falls back to the existing color-initials avatar when absent).

**Real bug found & fixed mid-session**: `channel_access_token VARCHAR(255)` was too narrow for LINE's newer v2.1 (JWT-format) tokens — widened to `TEXT` (`sql/023`). Also fixed a **broken error-detection bug**: `String(prismaError).includes("P2002")` never actually matched (Prisma doesn't embed the code in the stringified message), so every real save error — including genuine duplicate-`destination` conflicts — showed the same unhelpful "บันทึกไม่สำเร็จ". Fixed to check `error.code === "P2002"` properly, and added `console.error` logging so future failures are diagnosable via `docker logs fun-app`.

**Known deploy-pipeline gotcha (fixed, worth remembering)**: the deploy tarball command used `--exclude='*.png'` to skip one stray root-level screenshot file, which **also excluded `public/logo.png`** from every build this session — the live site silently fell back to the "F" placeholder logo for a while. Fixed by excluding the specific filename (`Gemini_Generated_Image_skxkyxskxkyxskxk.png`) instead of the blanket pattern. **Any future manual deploy must use the specific-filename exclude, not `*.png`.**

---

## 3. Quotation feature (deployed, then patched twice post-launch)

**Scope decision**: full manual entry (no price catalog — `ADR-015` blocker re: SPS price data still stands), explicitly NOT modeled on the reference dealer system the user showed for comparison (Mazda Sky Journey) — same underlying idea (quote → PDF → send to customer) but deliberately different schema shape, UI flow, and wording per explicit instruction ("dont copy... ห้ามมีคำที่บ่งบอกว่าเลียนแบบ").

- **Schema**: `fun_quotation` gained `payment_type`, `color_price_adjust`, `deposit_amount`, `share_token` (unguessable, for the public PDF link), `sent_at`. New table `fun_quotation_item` (snapshot of selected option name/value per quote — doesn't break if the `fun_quote_option` master row is later renamed/deleted).
- **`fun_quote_option`** master expanded from 2 categories (addon/reg_insurance) to 7 (`addon`, `decor_exterior`, `decor_interior`, `decor_electronics`, `decor_other`, `reg_insurance`, `special_offer`) and seeded with ~85 starter items (`sql/025`) — Nutt said he'll revise the list himself, treat as a starting point.
- **Feature toggle**: `/settings/quotation-options` has a master on/off switch (`getFeatureFlags`/`setFeatureFlags` in `src/lib/settings.ts`, key `"features"`) gating both the "สร้างใบเสนอราคา" button in `/chat` and the create API server-side. **Defaults to OFF.**
- **Composer** (`/quotes/new?lead=X`): one scrolling page, option chips grouped by category (tap to add, set ซื้อ/แถม + value inline), sticky live-total bar. Own design, not a step wizard.
- **PDF** (`src/lib/quotePdf.tsx`, `@react-pdf/renderer`): teal masthead with the branch's registered company name, itemized table, totals card, signature lines. Two nasty Thai-rendering bugs in the PDF engine fixed here (**important if this file gets touched again**):
  1. **Never use `letterSpacing` on Thai text** — desyncs the renderer's width measurement from shaped glyphs, clips leading/trailing characters.
  2. **All text must go through the `<T>` wrapper, not `<Text>` directly** — `SARA AM` (ำ, U+0E33) needs to be fed as the decomposed pair (U+0E4D U+0E32) or the last glyph on any line containing it gets clipped. `fixThai()` does this substitution; `<T>` is a drop-in wrapper around `<Text>` that applies it.
  - Font: Noto Sans Thai (TTF files in `public/fonts/`, NOT Sarabun — Sarabun was tried first and had worse shaping behavior in this renderer).
- **Sending**: Flex card (not a plain text link) via `buildQuotePdfBubble()` in `src/lib/flex.ts` — button opens the PDF at `/api/public/quote/[shareToken]/pdf`. **PDF is served as `Content-Disposition: attachment`, not `inline`** — this was a real "cannot load" bug fix: LINE's in-app browser can't reliably render a PDF inline, but can download one to the device's own viewer.
- **Flex card content** was revised once already based on a user-shown reference example: shows ลูกค้า/รุ่นรถ/ผู้เสนอ(company name)/วันที่ออกเอกสาร/เลขที่เอกสาร/ยอดสุทธิ, own teal header wording (not copied). PDF vehicle card also got a "รหัสรุ่น" (model code) line pulled from `VehicleModel.modelCode` via the quote's `modelId`.

**Not yet built**: booking-stage transition from a sent quote, PDF preview from the staff side beyond the redirect route, quote edit/versioning UI (schema has `version` field, unused so far).

---

## 4. Per-user menu access (deployed)

- `fun_user.menu_access` (TEXT/JSON, nullable) — NULL = pure role defaults (zero behavior change for existing users), else `{"menuKey": bool}` overrides.
- Single registry `src/lib/menuAccess.ts` (`MENU_DEFS`, `resolveMenus`, `menuKeyForPath`) shared by server (`/api/me`, `/api/users`) and client (`Sidebar`, `Chrome` page gate, `SettingsShell` tab filter).
- **Enforcement**: menus hidden from sidebar + blocked page entry (shows "ไม่มีสิทธิ์เข้าถึงเมนูนี้" instead of the page) if a user navigates directly by URL. API routes keep their own `requireRole` checks — this layer is workflow shaping, not the security boundary by itself.
- Editable per-user in `/settings/users` (per-user edit form → chip toggles for each menu, badge showing "ตามบทบาท" vs "กำหนดเอง", reset-to-role-defaults button). **Self-lockout guard**: an admin can't disable their own "settings" menu access.

### Manager/Admin settings split (built same session, on top of the above)
User req: manager gets ทีมขาย, รุ่นรถและสี (brand-scoped to their own branch access), ตั้งค่าใบเสนอราคา, Conversion Rate — everything else (users, branches, LINE OA, sources, channels, automation, logs, status) stays admin/gm only.
- New menu keys: `settings-teams`, `settings-models`, `settings-quotation`, `settings-conversion-rate` (role default: manager+gm+admin) vs. `settings` (admin core, gm+admin only — unchanged monolithic catch-all for everything not in the 4 new keys).
- Sidebar's single "ตั้งค่า" entry now resolves its target dynamically per-user (`settingsLandingHref()`) — admin/gm still land on `/settings/users`, a manager with only the delegated slice lands on `/settings/teams`.
- `SettingsShell`'s horizontal tab bar filters to whichever sub-pages the signed-in user can actually open.
- **Real server-side enforcement, not just hidden UI**: `/api/models`, `/api/models/[id]`, `/api/models/[id]/colors`, `/api/colors/[id]` now allow role `manager` but check the target model/color's actual `brandId` against `managerAllowedBrandIds()` (new helper in `src/lib/authz.ts`, derived from the manager's `UserBranch` links) — a manager cannot touch a brand they don't have branch access to, even via direct API calls. `/api/teams`, `/api/quote-options`, `/api/settings/conversion-rates` just got `manager` added to their role allowlist (no brand scoping needed for those — not brand-scoped data).
- `/settings/models` page filters its brand tabs client-side for `role==="manager"` (derives allowed brands from the manager's own `branchIds` via `/api/users?all=1`, cross-referenced with `/api/branches`'s branch→brand map).

---

## 5. Owner-switch consent → toggle + safety net (deployed)

- New setting `ownerSwitchConsent` (`src/lib/settings.ts` `getOwnerSwitchConfig`/`setOwnerSwitchConfig`), toggle added to `/settings/automation` (same page as the LINE welcome-quota toggle — no better-fitting existing category).
- **On** (default, matches original 2026-07-10 behavior): customer scanning a different salesperson's QR (same brand, existing active/nurture lead) gets asked via Flex bubble whether to keep or switch — never silent.
- **Off**: no question asked, current (active) owner kept silently, normal welcome push sent instead.
- **Safety net regardless of the toggle**: if the *current* owner's account is inactive (left/disabled), the lead auto-reassigns to whoever just scanned — no question asked either way, since there's no one to "keep" the customer with. This was a direct answer to a user-raised edge case ("what if the customer's LINE is bound to an old salesperson who's gone").

---

## 6. Welcome push message wording (deployed)

Template changed to lead with the brand name and clarify wording:
```
{ยี่ห้อ} ช.เอราวัณ ยินดีให้บริการ
ที่ปรึกษาการขายของท่านคือ
คุณ {ชื่อเล่นเซลส์} จาก โชว์รูม {ชื่อสาขา}
เบอร์ติดต่อ {เบอร์เซลส์}
```
(previously combined brand+branch into one "โชว์รูม" line without a leading brand name).

---

## 7. NOT YET DEPLOYED — Flex/PDF wording polish

Built + typechecked + built clean at session end, but the user asked to write this recap ("context เต็มแล้ว") before confirming deploy. Changes:
- `buildQuotePdfBubble()` (`src/lib/flex.ts`) — richer row set (ลูกค้า/รุ่นรถ/ผู้เสนอ/วันที่ออกเอกสาร/เลขที่เอกสาร/ยอดสุทธิ), own header wording, reviewed against a user-supplied reference example (a real Sky Journey quotation PDF + Flex screenshot) for structural ideas WITHOUT copying — explicit user instruction to avoid anything that reads as imitation.
- `src/app/api/quotes/[id]/send/route.ts` — now passes `companyName` (from `lead.branch.companyNameFull`) and `createdAt` into the bubble builder; needed `branch: true` added to its lead include.
- `src/lib/quotePdf.tsx` + `src/app/api/public/quote/[token]/pdf/route.ts` — added a "รหัสรุ่น" (model code) line to the vehicle info card, joined from `VehicleModel.modelCode` via `quote.modelId` (data already existed, just wasn't queried before).

**No new SQL migration for this piece** — pure code change.

---

## 8. Deploy status — what's live vs. pending

**Applied to prod DB this session** (in order): `sql/019` through `sql/023`, `sql/025`, `sql/026`, `sql/027`. **`sql/024` (reset stale `destination` values) was blocked by the safety classifier** (table-wide UPDATE, no WHERE clause) and its status is unconfirmed — it's optional/self-healing (the auto-detect webhook overwrites any wrong stored value the first time a real signature-matched message arrives for that brand), so don't assume it ran; don't re-run blindly either without checking first.

**Code deploy history this session**: multiple `tar → scp → docker build → compose up --force-recreate` cycles, the last CONFIRMED one included through §6 (owner-switch, welcome message, manager/admin settings split, PDF/Flex/webhook bug fixes) — verified via `docker logs fun-app` clean startup + `307` on both `localhost:3102` and the public domain, plus a direct `curl` re-test of the PDF endpoint confirming the `Content-Disposition: attachment` header.

**§7 (this recap's newest section) is sitting in the working tree, built and typechecked clean, NOT deployed.** To finish: rebuild the tarball (remember the specific-filename PNG exclude, not `*.png`), `scp` to NAS, `docker build` with the 3 build-args (`NEXT_PUBLIC_LIFF_ID`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BUILD_VERSION=$(date +%Y%m%d-%H%M)`), `docker compose up -d --force-recreate app`, then verify `docker logs fun-app` + `curl` both endpoints + spot-check the PDF/Flex card visually. No new migration needed for this specific batch.

**Established deploy pipeline** (NAS `192.168.0.10:2022`, key-based SSH, passwordless):
```bash
tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=.claude --exclude=clipboard \
    --exclude='Gemini_Generated_Image_skxkyxskxkyxskxk.png' --exclude='*.zip' \
    -czf /tmp/fun-src.tar.gz .
scp -O -P 2022 /tmp/fun-src.tar.gz nutnet@192.168.0.10:/volume1/docker/fun/fun-src.tar.gz
ssh -p 2022 nutnet@192.168.0.10 "cd /volume1/docker/fun && rm -rf srcbuild && mkdir srcbuild && tar -xzf fun-src.tar.gz -C srcbuild"
ssh -p 2022 nutnet@192.168.0.10 "cd /volume1/docker/fun/srcbuild && sudo -n /usr/local/bin/docker build -t fun:latest \
    --build-arg NEXT_PUBLIC_LIFF_ID=\$(grep -m1 NEXT_PUBLIC_LIFF_ID ../.env | cut -d= -f2-) \
    --build-arg NEXT_PUBLIC_APP_URL=https://fun.ch-erawan.com \
    --build-arg NEXT_PUBLIC_BUILD_VERSION=\$(date +%Y%m%d-%H%M) ."
ssh -p 2022 nutnet@192.168.0.10 "cd /volume1/docker/fun && sudo -n /usr/local/bin/docker compose up -d --force-recreate app"
```
SQL migrations apply via: `scp` the file to `/tmp/` on the NAS, then `docker exec -i mariadb-erawan mysql --default-character-set=utf8mb4 -uroot -p'Er@w@n12345' ch_lead_fun < /tmp/0XX_name.sql`. Both the deploy and any DB write are gated by an auto-mode safety classifier that requires an explicit, freshly-stated instruction naming the action (a bare "yes" sometimes isn't enough if the classifier judges the conversation context ambiguous) — if a command gets denied, just ask the user to restate it more explicitly rather than trying to route around the block.

---

## 9. Outstanding / carried forward

- **Chat inbound bug** (pre-existing, from Task #31/#32, unrelated to this session's work) — still not investigated this session. See project memory `chlead-fun-chat-inbound-bug.md`.
- **Lepas vehicle model lineup** — placeholders only ("Model 1/2/3"), needs Nutt to supply the real model names.
- **Weighted Pipeline / Run Rate**: no further gaps known.
- **Quotation feature**: no PDF/Flex preview automation in CI, no booking-stage auto-transition, no versioning UI yet (schema supports it).
- **LINE OA rollout**: all 8 brands have LIFF IDs and Messaging credentials; destination auto-detect is live but unverified end-to-end with a real customer message per brand — worth confirming `/settings/line-oa` shows "ตรวจพบ bot แล้ว" (not "ยังไม่มีข้อความเข้ามา") for each brand once real traffic flows.
- **Per-user menu access**: only exercised by the developer/admin so far — worth having a real manager log in and confirm they see exactly the 4 delegated settings pages and nothing else.
