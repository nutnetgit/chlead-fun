# Ch.Lead FUN — Full Project Context (for new session bootstrap)

**Last updated:** 2026-07-08
**Repo:** `C:\Users\Nutne\OneDrive\Documents\ClaudeCode\CHLFUN`
**Live URL:** https://fun.ch-erawan.com
**Stack:** Next.js 16.2.9 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Prisma 5 (pinned) + Auth.js v5 (beta)
**DB:** MariaDB on NAS `192.168.0.10:3308` (host) / `mariadb-erawan:3306` (internal), database `ch_lead_fun`
**Deploy:** Docker, built ON the NAS (local Docker Desktop is dead) — tar source → pscp → extract → `docker build` → `docker compose up --force-recreate`, container `fun-app` on port 3102, exposed via Cloudflare Tunnel

---

## What this system is

**Ch.Lead FUN** (= Ch.Erawan Lead Follow-Up Nudger — official full name) is a multibrand car-dealership sales-lead-management system for Ch.Erawan Group (6 brands: Mazda, GWM, Ford, Deepal, Isuzu, Autopro/unbranded — 9 branches). It fully replaces the legacy PHP "Prospect" module inside the old SPS DMS (`D:\adamsps`, Laravel/PHP, DB `cherawan` — **never touched directly**, read-only reference only, all touching blocked pending explicit owner approval).

Originally scoped as just an FB-Lead-Ads-intake + AI-nudge bot ("Lead Follow-Up Nudger"), the project was re-scoped mid-build (2026-07-06) into a full Prospect-module rebuild ("Prospect 2.0" was the internal working name; the shipped/official name reverted to **Ch.Lead FUN**). The original FB-intake/AI-nudge pieces survive as one intake channel among several (walk-in, QR self-intake, manual add, FB Lead Ads).

### Core business flow
```
Lead comes in (FB ad / walk-in / QR / manual)
  → Person + Lead created, deduped by phone (fun_person_identifier)
  → AI scores hot/warm/cold (Gemini) — human's manual temperature always wins on conflict, tagged temperatureConflict
  → Salesperson works the lead through 8 pipeline stages (kanban or list view)
  → SLA engine (hourly cron) watches idle time: nudge → escalate to manager → forfeit to pool
  → Manager governs via LINE 3-button flow: nudge again / reassign / exempt
  → Booking = final stage (finance re-keys into legacy SPS manually — no auto-bridge yet)
  → Terminal leads (lost/forfeited/won) auto-archive after 30 days idle (soft-delete, never hard-deleted)
```

---

## 1. Business Logic

### Lead lifecycle & scoring
- **8 pipeline stages:** new → contacted → qualified → appointment → test_drive → negotiation → finance_check → booking, plus terminal `nurture` / `lost` / `forfeited`
- **Temperature (hot/warm/cold):** human-settable; AI (Gemini) also scores 0–100 → tier-mapped. If human hasn't set temperature, AI's tier becomes it outright. If human HAS set it and AI's tier is >1 apart (e.g. human=hot, AI=cold), system **forces temperature to 'warm'** and sets `temperatureConflict=1` (never silently overrides a human with an AI opinion, but flags real disagreement loudly — visible as a triangle badge everywhere the lead appears). AI only re-scores leads with `aiScore IS NULL` (score-once, not nightly re-check — avoids re-billing Gemini for stable leads).
- **SLA idle ladder** (hourly cron `/api/jobs/sla`): idle clock = `last_activity_at` (fallback `created_at`). Per-brand/branch/channel/temperature rules (`fun_sla_rule`, most-specific-wins matching) define `idle_nudge_days` → `idle_escalate_days` → `idle_forfeit_days`. Each (lead, event_type) breach logged once while unresolved; auto-resolves as `sales_acted` once a fresh activity postdates the flagged time. Forfeit returns the lead to `fun_lead_pool` (priority hot>warm>cold) for reclaim by any salesperson via `/pool`. Cold leads with no forfeit threshold move to `nurture` after 2× the escalate threshold (documented extrapolation, not from the original spec). First-response breach (never contacted within X minutes of creation) is tracked separately.
- **Auto-archive** (same hourly cron, final step): terminal-status leads (`lost`/`forfeited`/`won`, NOT `nurture`) idle >30 days get `archivedAt=now()` — soft-archive, same CATS-candidate pattern, never hard-deleted, manually un-archivable.

### Governance (manager control via LINE)
Three actions available on the SLA-escalate LINE card, manager/gm-only:
- **nudge_again** — logs a fresh activity (DB trigger resets idle clock), pushes a reminder to the owner, resolves the escalate event as `sales_acted`
- **reassign** — unassigns owner, returns to pool, logs `assignment_history` reason=`manual_by_manager`, resolves as `manager_reassigned`
- **exempt** — deep-links to `/governance/exempt?lead=X` (LINE buttons can't collect free text) → requires manager + written reason → logs `activity_type='sla_override'`, resolves as `exempted`

### Cross-brand switching
When a customer switches interest brand, `/api/leads/[id]/switch-brand`: old lead → `status=lost`, `lost_reason_group='switched_brand'` (excluded from real loss analytics); new lead created in target brand, **same person, same owner** (credit follows the salesperson, not the brand — ownership grants lead-scoped access without needing full brand visibility), carries over stage/temp/payment/channel/campaign, links via `origin_lead_id`. Managers of both branches get an instant LINE DM (visibility-as-guardrail philosophy, not an approval gate).

### Multi-brand / multi-branch sales permissions
Not a separate system — brands are per-branch (`fun_branch.brand_id`); a user's sellable brands are just the union of brands across their accessible branches (`fun_user_branch`, many-to-many). `/settings/users` surfaces this derivation live (branch chips → brand-chip preview) rather than needing its own permission model.

### Events / campaigns
Manager-created campaigns (`fun_campaign`) can span multiple brands, set per-salesperson lead targets (`fun_campaign_target`), and are the "source" for QR self-intake at a booth. Metrics computed live from `lead.campaignId` groupBy. Events are never deleted — filtered by a year dropdown as history accumulates ("เก็บไว้เช็คย้อนหลัง").

### Run Rate forecasting
Count-based (not money — money returns once ad-spend data exists): projects month-end lead volume from days-elapsed pace, computes 90-day-cohort conversion rate (overall + per source), forecasts bookings/revenue, shows the gap to a manager-set monthly target with **both levers** (leads needed at current CR, OR CR needed at current volume). Monthly target has carry-over (surplus/deficit rolls forward from the first month with real bookings — avoids a fake deficit in pre-launch months).

### AI persona — "น้องไอรา" (Aira)
All user-facing AI output speaks as "Aira" (internal code/comments still say Gemini/AI — only UI copy changed). Two AI touchpoints:
- **Morning digest** (07:30 cron → LINE DM to managers): live team stats → Gemini-composed Thai briefing, deterministic fallback if Gemini fails
- **Lead summarizer** (button in lead detail): 3-line Thai brief (where/blocked/next-action) — deliberately **not stored as an activity** (would falsely reset the SLA idle clock)

### Authentication (2 paths, both gate on admin approval)
- **LINE Login** — self-registration; first-ever sign-in becomes admin automatically (bootstrap), everyone after is `PENDING` until an admin approves + assigns role/branches in `/settings/users`
- **Username + password** (added Task #30) — admin-provisioned only, no self-registration; admin sets a username and issues a one-time temp password; user is forced to set their own password on first login; 5 failed attempts → 15 min lockout
- Session role is baked into the JWT at sign-in and refreshed from DB on every request; middleware enforces role/approval gates at the edge (decode-only, no DB call in middleware itself)

### Delete-vs-archive policy (system-wide decision)
- **Leads:** soft-archive only (`archivedAt`), auto after 30d terminal-idle or manual toggle — never hard-deleted
- **Events/campaigns:** never deleted, year-filtered
- **Brands/branches/models:** hard-delete allowed ONLY if unreferenced (blocked with a Thai reason string listing what references them) — otherwise deactivate via `isActive` toggle

---

## 2. Database Schema

**Migration history:** `sql/001` through `sql/013` (sequential, additive, applied live on NAS each time — no `prisma migrate`, schema owned by raw SQL, Prisma mirrors it with `@map`).

| # | File | What it did |
|---|------|-------------|
| 001 | fun_schema.sql | Original 5-table FUN-only schema (channels, settings, etc.) — mostly superseded by 002 |
| 002 | prospect2_schema.sql | **The big one** — full 29-table Prospect 2.0 schema replacing the original 5 tables |
| 003 | branch_code.sql | `fun_branch.branch_code` UNIQUE (for channel_config join) |
| 004 | adr011_conflict.sql | `fun_lead.temperature_conflict` + `sla_override` activity type |
| 005 | fix_resolution_column.sql | Fixed ENUM/VARCHAR Prisma mismatch bug (see gotcha below) |
| 006 | enum_to_varchar.sql | Systemic fix: converted 14 more ENUM columns to VARCHAR across 11 tables |
| 007 | user_branch.sql | `fun_branch.brand_id` FK + `fun_user_branch` junction table (multi-branch access) |
| 008 | model_master.sql | `fun_model.is_active/dms_model_id` + `fun_vehicle_color` table |
| 009 | events_qr.sql | `fun_campaign_brand` + `fun_campaign_target` junctions + `campaign.target_leads` |
| 010 | auth_approval.sql | Approval fields for LINE Login registration flow |
| 011 | switch_brand.sql | `origin_lead_id` FK + `line_id` identifier type + `switched_brand` lost-reason |
| 012 | lead_archive.sql | `fun_lead.archived_at` DATETIME NULL + index |
| 013 | credentials_login.sql | `fun_user.username/password_hash/must_change_password/failed_login_count/locked_until` |

### Full model list (prisma/schema.prisma, all tables prefixed `fun_`)

**Enums:** PersonType, IdentifierType, ConsentPurpose, ConsentChannel, ConsentStatus, ChannelCategory, PaymentType, BuyTimeframe, LeadStage, Temperature, LeadStatus, ActivityType, ActivityDirection, NudgeTrigger, UserRole

**Core entities:**
- `Person` / `PersonIdentifier` (phone/line_id/line_userid — dedup key) / `PersonConsent` (PDPA)
- `Lead` (the central table — brand, branch, channel, campaign, owner, stage, temperature, temperatureConflict, aiScore/aiScoreReason, nextActionAt, lastActivityAt, firstResponseAt, archivedAt, origin_lead_id)
- `LeadStageHistory` / `Activity` (append-only timeline; DB trigger `trg_activity_touch_lead` updates lead's last_activity_at + first_response_at)
- `Appointment`, `Quotation`, `FinanceApplication`, `TradeinAppraisal`, `BookingHandoff` (commercial pipeline — NOT all built out in UI yet, schema exists ahead of app)

**Org / master data:**
- `Branch` (+ `brandId` FK), `Brand`, `UserBranch` (junction), `FunUser` (role, branchId home, lineUserid, + Task #30's username/passwordHash/mustChangePassword/failedLoginCount/lockedUntil), `Team`
- `VehicleModel` / `VehicleColor` (per-brand model+color master, `dms_*` columns pre-provisioned for future SPS sync, still unapproved)
- `DutyRoster`, `StockSnapshot`, `KpiDaily` (exist in schema, lightly used)

**Marketing / intake:**
- `SourceChannel`, `Campaign` / `CampaignBrand` / `CampaignTarget`, `ChannelConfig`, `LostReason`

**Governance / SLA:**
- `SlaRule`, `SlaEvent`, `AssignmentHistory`, `LeadPool`, `NudgeLog`

**Config:**
- `Setting` (key-value, e.g. `runrate_config`)

### Known gotchas (don't repeat these bugs)
- **ENUM(DB) vs String(Prisma) mismatch (P2032):** any status-ish column MUST be either a real Prisma enum OR VARCHAR in the DB — never `ENUM` in MariaDB + `String` in Prisma. This threw `Error converting field ... of expected non-nullable type String` on UPDATE (and later, INSERT with a non-NULL value). Fixed systemically in 005+006; the rule is now documented in the repo README.
- **mysql client charset:** any raw SQL touching Thai text with emoji MUST use `--default-character-set=utf8mb4` or it throws `ERROR 1366`.
- **Credential materialization block (Claude Code's classifier):** never pipe a live password into `sudo -S`, and never curl a real login+password against production and print the session cookie — both are hard-blocked regardless of user authorization/phrasing. Use scoped NOPASSWD sudoers for sudo; use credential-free checks (`/api/auth/providers`, DB row checks, build/typecheck) to verify auth flows, and hand live login testing to the user.

---

## 3. UI Design

### Design system (v2 = GOLD, current — supersedes an earlier teal v1)
- Palette: `#EFEDE7` cream ground, `#F3B01C` gold primary, `#B57F06` gold-deep, dark-on-gold text (`#3A2C05`, not white)
- Full light/dark theme via `:root[data-theme]`, toggle persisted in `localStorage`
- Font: IBM Plex Sans Thai (`next/font/google`)
- Whole app sits inside one rounded 24px frame (`Chrome.tsx`) — sidebar + header + main all inside it, not separate cards
- Logo: `public/logo.png` (Ch.Erawan elephant badge) with `onError` fallback to a plain "F" block
- **Blur spec for all overlays/modals:** `bg-black/45 backdrop-blur` (45% dim + 8px blur) — precisely specified by the user from inspecting the CATS app; supersedes earlier rough guesses. (Note: `ForcePasswordChange.tsx` currently shows `bg-black/5 backdrop-blur-sm` due to a linter auto-edit during Task #30 — flagged as a possible follow-up to restore the standard spec.)
- No `tailwindcss-animate` plugin in this repo (unlike CATS) — animations are hand-rolled `@keyframes` in globals.css (`.slide-panel-right`, `.fade-in-backdrop`)

### App shell (`src/components/Chrome.tsx`)
- Collapsible left sidebar (icon rail at 68px, `localStorage sb-mini`), grouped by role: งานขาย/เซลส์ (sales) · ผู้จัดการ (manager) · ตั้งค่า/Admin
- Header: dark-mode toggle + user chip (LINE picture avatar or 2-letter fallback) + dropdown (เปลี่ยนรหัสผ่าน / ออกจากระบบ)
- `MeContext` provides `useMe()` hook app-wide from `/api/me`
- `ForcePasswordChange` overlay renders above everything when `mustChangePassword` is true
- `BARE_ROUTES` (`/lead-form`, `/login`, `/pending`) render without the chrome — public/auth pages only

### Key pages
| Route | Audience | Purpose |
|---|---|---|
| `/leads` | sales | Default kanban board (8 stage columns, drag-drop) OR list+detail toggle; quick-log modal, one-tap temperature override, AI draft box ("น้องไอรา ร่างข้อความให้ส่ง"), calendar overlay, add-lead modal, QR self-intake modal, cross-brand switch modal |
| `/dashboard` | manager | 5 KPI cards, funnel-by-stage bars, temperature split, recent SLA events |
| `/lead-center` | manager | Per-salesperson workload cards (click-filters table), archived-view toggle, brand filter, paginated table (20/page), right-side `ContactPanel` slide-over |
| `/pool` | sales | Claim forfeited/unassigned leads (hot-first) |
| `/governance/exempt` | manager | SLA-exemption reason form (deep-linked from LINE) |
| `/events` | manager | Campaign CRUD, per-sales targets (brand-filtered eligibility), progress bars, year filter |
| `/runrate` | sales+manager | Forecast page, scoped by owner for sales, team+target-setting for managers |
| `/reports` | manager | Filterable KPI tiles + 4 breakdown tables + CSV export |
| `/logs` | admin/gm | Merged read-only audit timeline (5 append-only tables) |
| `/channels` | admin | Channel config CRUD |
| `/status` | admin | Health snapshot page |
| `/settings/users` | admin | User CRUD, pending-approval queue, branch/brand permission chips, username+password provisioning (Task #30) |
| `/settings/branches` | admin | Branch CRUD, brand management |
| `/settings/models` | admin | Vehicle model/color master |
| `/settings/sources` | admin | Source channel config |
| `/settings/automation` | admin | Automation job toggles (SLA/score/nudge/digest gates) |
| `/lead-form` | public (no chrome) | Customer-facing QR/ad-landing intake form |
| `/login` | public | LINE button + username/password form (Task #30) |
| `/pending` | authenticated, unapproved | Polls `/api/me` waiting for admin approval |
| `/account/password` | authenticated | Self-service password change (Task #30) |

### Key reusable components
- `KanbanBoard.tsx` — drag-drop pipeline board
- `ContactPanel.tsx` — right-side slide-over lead detail (CATS-pattern: fixed overlay, blur backdrop, click-to-close), includes archive/unarchive toggle
- `CalendarModal.tsx` — month grid with per-day due/appointment counts
- `AddLeadModal.tsx`, `QrLeadModal.tsx` — manual/QR lead creation
- `ForcePasswordChange.tsx` — blocking password-change overlay (Task #30)
- `Sidebar.tsx` — role-grouped nav, collapsible, mobile drawer
- `src/lib/date.ts` — central `fmtDate()`/`fmtDateTime()`/`fmtDayMonth()` utility enforcing dd/mm/yyyy **Gregorian** display everywhere (Thai locale defaults to Buddhist-era years — must never use raw `toLocaleDateString("th-TH")`)

---

## 4. API Endpoints

### Auth
- `GET/POST /api/auth/[...nextauth]` — NextAuth handler (LINE OIDC + Credentials providers)
- `GET /api/me` — live session info (role, approved, branchId, mustChangePassword) — polled by `/pending`, drives `Chrome.tsx`
- `POST /api/account/password` — self-service password change

### Leads (core)
- `GET /api/leads` — `?filter=due|all|archived`, `?owner=` — list with owner names, due-days, conflict flags
- `GET /api/leads/[id]` — full detail (30-activity timeline, nudge draft)
- `PATCH /api/leads/[id]` — stage/temperature updates (clears conflict on manual override), `{ archived: boolean }` toggle
- `POST /api/leads/[id]/activity` — quick-log (auto-advances stage new→contacted, sets first_response_at)
- `POST /api/leads/[id]/summarize` — Aira 3-line summary (ephemeral, not persisted)
- `POST /api/leads/[id]/switch-brand` — cross-brand lead transfer
- `POST /api/public/lead` — public QR/ad-landing intake (validates all encoded ids server-side)

### Governance / SLA
- `GET /api/pool` — unclaimed forfeited leads, hot-first
- `POST /api/pool/[id]/claim` — claim a pooled lead
- `POST /api/governance/exempt` — SLA exemption with required reason
- `POST /api/jobs/sla` — hourly cron: idle ladder + first-response breach + auto-archive (x-api-key auth)

### AI jobs (n8n cron-triggered, x-api-key auth)
- `POST /api/jobs/score` — Gemini hot/warm/cold scoring
- `POST /api/jobs/nudge` — Gemini Thai nudge draft + LINE Flex push
- `POST /api/jobs/digest` — Aira morning digest to managers (07:30 cron)

### Webhooks
- `GET/POST /api/webhooks/fb-meta` — Meta Lead Ads (challenge verify + signature-verified POST)
- `POST /api/webhooks/fb-lead-ingest` — server-to-server FB ingest (WEBHOOK_SECRET auth)
- `POST /api/webhooks/line` — LINE postback events (governance buttons) + group-id capture

### Master data / settings
- `GET/POST /api/users`, `PUT /api/users/[id]` — user CRUD, branch access, approval, **Task #30: username + `resetPassword` flag**
- `GET/POST /api/branches`, `PUT /api/branches/[id]` — branch CRUD
- `GET/POST /api/brands`, `PUT/DELETE /api/brands/[id]` — brand CRUD (delete-if-unused)
- `GET/POST /api/models`, `PUT /api/models/[id]`, `POST /api/models/[id]/colors`, `PUT /api/colors/[id]` — vehicle master
- `GET/POST /api/channels`, `PUT /api/channels/[id]` — channel config
- `GET/POST /api/sources`, `PUT /api/sources/[id]` — source channel config
- `GET/PUT /api/settings` — key-value config (e.g. `runrate_config`)
- `GET/PUT /api/settings/automation` — automation job on/off gates

### Events / campaigns
- `GET/POST /api/events`, `PUT/DELETE /api/events/[id]` — campaign CRUD (`?active=1` filters for QR picker)

### Reporting
- `GET /api/dashboard` — manager KPI summary
- `GET /api/reports` — filterable breakdown data
- `GET /api/reports/export` — CSV export (UTF-8 BOM for Thai-in-Excel)
- `GET /api/runrate`, `PUT /api/runrate` — forecast data + config
- `GET /api/logs` — merged audit timeline
- `GET /api/calendar` — month view due/appointment counts

---

## 5. Infra / Deploy Facts (for a new session to not re-discover)

- **NAS SSH:** `nutnet@192.168.0.10:2022`, key-based (`~/.ssh/id_ed25519`), passwordless
- **Sudo on NAS:** scoped NOPASSWD sudoers rule already set up for docker binary paths — no password needed for docker commands anymore
- **Deploy pipeline:** tar source (exclude node_modules/.next/.git) → `scp` to `/volume1/docker/fun/fun-src.tar.gz` → ssh extract to `srcbuild/` → `docker build -t fun:latest .` (background, ~5 min) → `docker compose up -d --force-recreate app` → verify `curl localhost:3102` + `curl https://fun.ch-erawan.com`
- **Local Docker Desktop is dead** (WSL docker-desktop distro won't restart) — always build on NAS, not locally
- **DB access for migrations:** `docker exec mariadb-erawan mysql --default-character-set=utf8mb4 -uroot -p'Er@w@n12345' ch_lead_fun` — for anything with special chars/`$`, write SQL to a file and `scp` it rather than inlining (bash escaping breaks bcrypt hashes etc.)
- **Env vars live at:** `/volume1/docker/fun/.env` on NAS — must `scp` BOTH `.env` AND `docker-compose.yml` when adding new env refs (recurring gotcha, forgotten 3× historically)
- **Auth secrets set:** `AUTH_LINE_ID=2010635280`, `AUTH_LINE_SECRET` set, `AUTH_SECRET` generated, `AUTH_TRUST_HOST=true` (required — app sits behind Cloudflare Tunnel which terminates TLS at the edge)
- **Cloudflare Tunnel:** `fun.ch-erawan.com` → `http://fun-app:3000`, no Cloudflare Access gate (auth now handled by the app's own LINE/Credentials login instead)
- **Test login credential (for the owner to verify Task #30):** username `admin` / temp password `Erawan9326!` set on user_id 22 (Nutt) — forces password change on first use

---

## 6. What's NOT built yet / open threads

- **§8 Booking Handoff:** schema exists (`BookingHandoff` model) but no UI/API built — booking stage is currently just a pipeline stage, no bridge to legacy SPS re-keying
- **Meta App Review / Business Verification:** still pending — FB Lead Ads intake is code-complete and tested but blocked upstream by Meta's permission grant; `/lead-form` works as a landing-page fallback regardless
- **Voice-to-text activity notes:** discussed, not built — would need object storage (Garage S3 on NAS) + upload UI + Whisper/Gemini transcription
- **Legacy SPS import:** blocked — `pp/` source folder never provided, full DB dump incomplete (no customer/prospectcontact/branch tables in what's available); explicitly do not touch `D:\adamsps` without fresh explicit approval
- **ADR-010 (mandatory Booking Handoff gate before SPS re-key):** proposed but NOT accepted — blocked on a business-owner mandate, do not hard-code enforcement
- **ADR-013 (parallel-run/cutover tracking against old SPS):** blocked — user said not to touch the old DB yet
- **Password self-service "forgot password" flow:** not built (no email provider; would need LINE DM delivery of a reset code, similar to CATS's pattern, if requested later)
- **⏰ Chat Response SLA (ADR-016, drafted 2026-07-08, schema-only — REMINDER to build later):** user asked to draft a schema for measuring "เวลาตอบสนองแชท" (chat response time) as an SLA metric, tied to the in-house LINE chat system idea (also discussed 2026-07-08, not started). Full design in `prospect2-adr-log.md` ADR-016 — new `fun_chat_message` table + `fun_sla_rule.chat_response_minutes` + new `fun_sla_event` type `chat_response_breach`, extending the existing SLA Engine (`src/lib/jobs/sla.ts`) rather than a parallel system. **Only buildable once the in-house chat UI itself exists** — flag this ADR to the user before starting that chat feature.
- **In-house LINE chat system (staff reply from the web app instead of LINE OA Manager):** discussed 2026-07-08, feasibility confirmed, not started — needs its own plan (new chat UI, message persistence, assignment/locking). The per-staff QR→LINE-follow linking part is already solved (see LIFF welcome flow, §1/§4 above). LINE message quota is now configurable (`/settings/automation` → "โควตาข้อความ LINE"), addressing the cost concern raised for this feature.

---

## 7. Original design docs still in the repo (reference only)

- `prospect2_handoff.md` — original full spec/handoff document
- `prospect2-schema-design.md` — 24→29-table schema design
- `prospect2-adr-log.md` — ADR-001 through ADR-014 (**authoritative over handoff body text when they conflict**)
- `prospect2-glossary.md` — terminology reference
- `prospect2-sales-web.html` — early teal-theme static mockup (visual reference only, superseded by the current gold theme; not code to reuse directly)
- `ch_lead_fun_handoff.md` — the very original FB-intake-only spec (mostly superseded, infra facts like NAS ports/creds still accurate)
- `README.md` — should reflect current reality; re-check/update if it feels stale

---

*This document is a point-in-time snapshot for bootstrapping a new session. For deep history and reasoning behind each decision, see the auto-memory file `chlead-fun-project.md` (persists across Claude Code sessions) — this MD is the condensed, structured version of that memory for quick onboarding.*
