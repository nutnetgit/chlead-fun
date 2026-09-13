# Ch.Lead FUN — Full Project Context (for new session bootstrap)

**Last updated:** 2026-09-13
**Repo:** `C:\Users\Nutne\OneDrive\Documents\ClaudeCode\CHLFUN` · **GitHub:** github.com/nutnetgit/chlead-fun (branch `master`)
**Live URL:** https://fun.ch-erawan.com
**Stack:** Next.js 16.2.9 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Prisma 5 (pinned) + Auth.js v5 (beta) + node-cron in-app scheduler + mysql2 (read-only SPS reader)
**DB:** MariaDB on the NAS, container `mariadb-erawan`, database `ch_lead_fun` (host port 3308, internal 3306)
**Deploy:** Docker image `fun:latest` built on the Windows workstation, shipped to the NAS, run as container `fun-app` behind a Cloudflare Tunnel — procedure in §5

> **Start here, in this order.**
> 1. `docs/STATUS.md` — what is actually running right now, what is deployed vs only pushed, what is blocked on whom. Update it on every deploy.
> 2. The newest `TASK_NN_RECAP.md` in the repo root — what the last work session changed and why.
> 3. `docs/SPS_INTEGRATION.md` — everything about the link to the legacy SPS system; its §0 is the handover checklist for the DMS team.
> 4. §6 of this file — the rules and traps learned the hard way. Read it before changing auth, permissions, LINE, PDFs, or deploying.

> **No credentials in this repo.** Passwords, tokens and secrets live only in `/volume1/docker/fun/.env` on the NAS. An earlier version of this file and some older recaps contained a database password and a login password; those were removed on 2026-09-13 but remain in git history, so they must be treated as compromised and rotated (tracked in `docs/STATUS.md`).

---

## What this system is

**Ch.Lead FUN** (= Ch.Erawan Lead Follow-Up Nudger) is the multi-brand sales-lead system for Ch.Erawan Group: **8 brands** (Mazda, Ford, Mitsubishi, GWM, Deepal, KIA, GAC, Lepas) across **9 branches**. It replaces the legacy PHP "Prospect" module of the old dealer system **SPS** (a.k.a. the DMS, database `adam_prod`). SPS keeps everything from booking onward; Ch.Lead FUN owns everything before it.

SPS source is at `D:\adamsps` (plus a copy with schema/data dumps under `ClaudeCode\Insurance\legacy\adamsps`). It is read, never modified. Its database is never written by Ch.Lead FUN; the only planned database contact is a SELECT-only account for the vehicle catalogue (§6.5). A sister system, **CPT** (insurance/registration), lives at `ClaudeCode\Insurance` and set the integration patterns reused here.

Originally an FB-Lead-Ads-intake + AI-nudge bot, re-scoped on 2026-07-06 into a full Prospect rebuild ("Prospect 2.0" was the working name).

### Core business flow
```
Lead comes in (FB Lead Ads / walk-in / QR self-intake via LIFF / manual)
  → Person + Lead created, deduped by phone (fun_person_identifier)
  → AI scores hot/warm/cold (Gemini) — a human's temperature always wins; disagreement is flagged, never silently overridden
  → Salesperson works it through the pipeline (kanban or list), chats with the customer from /chat (per-brand LINE OA)
  → SLA engine (hourly) watches idle time: nudge → escalate to manager → forfeit to pool
  → Pipeline ENDS at จอง (booking). Booked leads leave the SLA ladder and auto-archive 5 days later.
  → From a booked lead, "เปิดใบจองใน SPS" hands the customer to SPS's booking form without a second login (built on our side; waiting for SPS's sso_land.php)
```

---

## 1. Business logic

### Lead lifecycle & scoring
- **Pipeline stages:** new → contacted → qualified → appointment → test_drive → negotiation → finance_check → booking, plus terminal `nurture` / `lost` / `forfeited`. **Booking is the end** — there is deliberately no "delivered" stage; delivery lives in SPS.
- **Temperature:** human-settable. Gemini also scores 0–100 → tier. With no human value the AI tier is used; if a human value exists and the AI tier is >1 step away, temperature is forced to `warm` and `temperatureConflict=1` is shown as a badge. AI scores only leads with `aiScore IS NULL`, plus the hourly chat-extract job re-scores leads with new inbound chat.
- **QR self-intake rules (2026-07-13):** the customer's chosen buy-timeframe sets temperature — `within_1m` → hot, `m1_3` → warm, `m3_6` and `over_6m` → cold. The **verified LINE profile name always wins** over the editable name box (`storedName = lineDisplayName || name`).
- **SLA idle ladder** (`src/lib/jobs/sla.ts`): idle clock = `last_activity_at` (fallback `created_at`). Most-specific `fun_sla_rule` wins (branch > brand > channel category > temperature). Thresholds editable at `/settings/sla-rules`. Forfeit returns the lead to `fun_lead_pool`. Booking-stage leads skip the ladder entirely.
- **Auto-archive:** booked leads 5 days after ENTERING booking (anchor = latest `fun_lead_stage_history` row with `toStage='booking'`, column `changedAt`); terminal leads (`lost`/`forfeited`/`won`) after 30 days idle. Soft-archive only, never hard-deleted, still counted in reports.

### Governance (manager control via LINE)
Three actions on the SLA-escalate LINE card, manager/gm only: **nudge_again**, **reassign** (back to pool), **exempt** (deep-links to `/governance/exempt` for a mandatory written reason). Sales cannot self-forfeit a lead; only the SLA job and manager+ can.

### Cross-brand switching
`/api/leads/[id]/switch-brand`: old lead → `lost` with reason group `switched_brand` (excluded from loss analytics); new lead in the target brand, same person, **same owner**, linked via `origin_lead_id`. Managers of both branches get a LINE DM.

### Brands, branches, and who sees what
- A branch belongs to one brand (`fun_branch.brand_id`). A user's reach = their `fun_user_branch` links + home branch.
- **Permissions (since 2026-09-09):** legacy SPS shape — one `fun_user_menu` row per user × menu with six flags `add / edit / cancel / del / report / viewall`; a row existing = can view. No rows = role default matrix. Details in §6.2.
- **Branch scoping:** manager-facing queries are limited to the manager's branches; admin/gm are global. `viewall` lifts it. Details in §6.3.
- **Events** (`fun_campaign`): everyone sees every event; only a manager's own branches' events are editable; `branch_id NULL` = central event managed by admin/gm.
- **Run Rate:** booking targets are per brand (`perUser` keyed `brandId:userId`), there is no combined-brands view, and the team target is always derived, never typed.
- **Header branch indicator:** read-only badge of the user's branch. The CPT-style branch *switcher* was built and then removed on 2026-09-09 as redundant with brand chips and the per-page "ทุกสาขา" filter. The add-lead form remembers the last branch used instead.

### Chat & LINE
- One LINE OA **per brand**, shared by all its branches. Staff sign in through a single central LINE Login channel; internal alerts (SLA, digest) go through the shared group OA.
- `/chat` shows only messages that resolve to a lead; **anything that resolves to no lead is dropped** (policy 2026-07-13), so service enquiries never enter the system.

### Quotations
Built 2026-07-12, behind the feature flag `features.quotationEnabled` (toggle at `/settings/quotation-options`). Manually priced (no price catalogue). PDF via `@react-pdf/renderer`, delivered to the customer as a LINE Flex card linking to an unguessable share token. Traps in §6.6.

### AI persona "น้องไอรา" (Aira)
All user-facing AI output speaks as Aira: morning digest to managers (07:30), on-demand 3-line lead summary (never stored as an activity, because that would reset the SLA clock), hourly chat extraction that fills blank lead fields from what the customer said without overwriting human input.

### Authentication
- **LINE Login** self-registration; the first ever sign-in becomes admin, everyone after waits in `PENDING` for approval.
- **Username + password**, admin-provisioned, forced change on first login, 5 failures → 15-minute lockout, bcrypt.
- **SSO from SPS** (third NextAuth provider, id `sso`) consuming single-use tickets — see `docs/SPS_INTEGRATION.md` §3.
- Auth is **always on** unless `AUTH_DISABLED=1` (see §6.1).

### Audit log
`fun_audit_log` records who did what to which record, from where and with what result: sign-ins and failures, permission changes, lead create/stage/reassign/forfeit, settings, exports, SSO steps, rejected webhooks, catalogue syncs. Secrets are never stored and phone numbers are masked. Browse and export at `/logs` → Audit. Retention `AUDIT_RETENTION_DAYS` (default 365; sign-in and permission rows kept twice as long).

### Delete-vs-archive policy
Leads: soft-archive only. Events: never deleted, filtered by year. Brands, branches, models: hard delete only while unreferenced, otherwise deactivate. Anything mirrored from SPS: never deleted, only deactivated.

---

## 2. Database

Schema is owned by raw SQL in `sql/NNN_*.sql` (sequential, additive, applied to production by hand as MariaDB root). Prisma mirrors it with `@map`; there is **no** `prisma migrate`. After editing `prisma/schema.prisma`, run `npx prisma generate`.

| Range | What it covers |
|---|---|
| 001–013 | Original schema, Prospect 2.0 tables, branch codes, ENUM→VARCHAR fixes, multi-branch users, model/colour master, events + QR, auth approval, brand switching, archive, credentials login |
| 014–018 | Expansions, quotation options, chat messages (multi-lead), owner-switch requests |
| 019–025 | Per-brand LINE OA config + LIFF, GAC/Lepas models, person picture + branch company fields, wider access-token column, quote option seed |
| 026–031 | Quotation build, per-user menu access (superseded), quote delivery fees, event branch, chat analysed-at, campaign brand targets |
| 032 | `fun_user_menu` six-flag permissions + `fun_user.dms_user_id` |
| 033 | `fun_audit_log` |
| 034 | `fun_sso_ticket` (hashed single-use tickets) |
| 035 | `fun_branch.dms_branch_id`, `fun_brand.dms_brand_id` |
| 036 | `fun_vehicle_color.color_code` |

All of 001–036 are applied in production.

**Main models:** `Person` / `PersonIdentifier` / `PersonConsent` · `Lead` (central) / `LeadStageHistory` / `Activity` · `Quotation` / `BookingHandoff` · `Branch` / `Brand` / `UserBranch` / `FunUser` / `UserMenu` / `Team` · `VehicleModel` / `VehicleColor` · `ChatMessage` · `SlaRule` / `SlaEvent` / `LeadPool` / `AssignmentHistory` · `Campaign` + targets · `AuditLog` / `SsoTicket` · `Setting` (key-value).

Database traps are in §6.7.

---

## 3. UI

- **Design system v2 = gold:** cream `#EFEDE7` ground, gold `#F3B01C` primary, dark-on-gold text. Light/dark via `:root[data-theme]`. Font IBM Plex Sans Thai.
- The whole app sits in one rounded 24px frame (`src/components/Chrome.tsx`). Header: read-only branch badge, theme toggle, user chip whose menu also offers "สลับไประบบอื่นของ ช.เอราวัณ" (links to SPS/CPT).
- `useMe()` from `Chrome.tsx` exposes `/api/me` app-wide, including the resolved permission map.
- Overlays: `bg-black/45 backdrop-blur`.
- Dates display as dd/mm/yyyy **Gregorian** through `src/lib/date.ts` — never raw `toLocaleDateString("th-TH")`.
- Per-page branch filter "ทุกสาขา (N)" lives in the URL (`?branch=`) and is re-validated server-side.

| Route | Audience | Purpose |
|---|---|---|
| `/leads` | sales | Kanban or list+detail, quick log, Aira draft, add/QR lead, brand switch, "เปิดใบจองใน SPS" on booked leads |
| `/chat` | sales | Per-brand LINE conversations, quotation creation |
| `/pool` | sales | Claim forfeited leads |
| `/runrate` | sales + manager | Forecast; per-brand targets |
| `/dashboard`, `/lead-center`, `/reports`, `/events` | manager | KPIs, workload, reports + CSV, campaigns |
| `/logs` | admin/gm | Timeline + Audit tab |
| `/channels` | delegable | Facebook Page → brand/branch routing |
| `/settings/users` | admin | Users, approval, six-flag grid, copy permissions, SPS user id, export |
| `/settings/branches` | admin | Branches and brands, SPS branch/brand ids |
| `/settings/models` | manager+ | Models and colours; SPS sync card; SPS-owned rows read-only |
| `/settings/line-oa`, `/settings/automation`, `/settings/sla-rules`, `/settings/quotation-options`, `/settings/sources`, `/settings/teams`, `/settings/conversion-rates` | admin / delegated | Configuration |
| `/lead-form`, `/liff/register` | public | Customer QR intake |
| `/sso` | public | Lands an SPS-issued ticket |
| `/login`, `/pending` | public / unapproved | Sign-in and approval wait |

---

## 4. API surface (highlights)

- **Session:** `/api/auth/[...nextauth]`, `GET /api/me`, `POST /api/me/branch`, `POST /api/account/password`, `PUT /api/account/profile`
- **Leads:** `/api/leads`, `/api/leads/[id]` (+ `activity`, `summarize`, `switch-brand`, `forfeit`, `quote`), `/api/pool`, `/api/chat/*`, `/api/quotes/[id]/pdf|send`
- **Public (no login):** `POST /api/public/lead` (rate limited), `POST /api/public/lead/welcome` (signed, expiring, rate limited), `GET /api/public/quote/[token]/pdf`, `GET /api/models`, `GET /api/brands`
- **Machine-to-machine:** `/api/jobs/{sla,score,nudge,digest,chat-extract}` and `/api/webhooks/fb-lead-ingest` require `x-api-key: WEBHOOK_SECRET`; `/api/webhooks/line` and `/api/webhooks/fb-meta` verify platform signatures
- **SPS link:** `POST /api/sso/handoff` (session), `POST /api/sso/verify` and `POST /api/sso/issue` (`X-Api-Token`), `GET /api/permissions/export`, `POST /api/permissions/import`, `POST /api/permissions/migrate`, `GET|POST /api/models/sync`
- **Reporting & audit:** `/api/dashboard`, `/api/reports` (+ `export`), `/api/runrate`, `/api/logs`, `/api/audit` (+ `?format=csv`)
- **Settings:** users, branches, brands, models, colors, channels, sources, teams, sla-rules, automation, features, line-oa, quote-options, conversion-rates

Scheduling: `src/instrumentation.ts` registers one hourly node-cron tick that runs every job; each job gates itself on its configured hour (SLA hourly, audit purge 03:00, SPS catalogue sync 02:00, and so on). The `/api/jobs/*` routes remain for manual triggering.

---

## 5. Infra & deploy

- **NAS SSH:** `nutnet@192.168.0.10`, port `2022`, key-based. `nutnet` is in the `docker` group; call docker by full path `/usr/local/bin/docker` (it is not on PATH for non-login SSH). The socket group is set with `chgrp docker /var/run/docker.sock`, which **resets when the NAS reboots** — if SSH docker commands start failing with "permission denied … docker.sock", that is why.
- **Env file:** `/volume1/docker/fun/.env` on the NAS. `docker-compose.yml` passes variables through explicitly — adding a new env var means editing **both** files.
- **Cloudflare Tunnel:** `fun.ch-erawan.com` → `http://fun-app:3000`. Real client IPs reach the app via `x-forwarded-for`.

**Build and ship (from the workstation):**
```bash
docker build -t fun:latest --build-arg NEXT_PUBLIC_BUILD_VERSION="$(date +%Y%m%d-%H%M)" .
docker save fun:latest | gzip > "$TEMP/fun.tar.gz"
scp -O -P 2022 "$TEMP/fun.tar.gz" nutnet@192.168.0.10:/volume1/docker/fun/
ssh -p 2022 nutnet@192.168.0.10 "cd /volume1/docker/fun && /usr/local/bin/docker load < fun.tar.gz && /usr/local/bin/docker compose up -d --force-recreate"
```
Verify with `docker images fun:latest --format '{{.ID}} {{.CreatedAt}}'` on the NAS: the ID equals the build log's `exporting config sha256:` prefix. Then update `docs/STATUS.md`.

**SQL migrations need MariaDB root**, which the app user `n8n_fun` does not have. The working pattern: put a one-shot `deploy_NNN.sh` and its `.sql` in `/volume1/docker/fun/`; the script reads the root password from the `mariadb-erawan` container's own environment (never printed), skips itself if already applied, runs the SQL **before** loading the new image, then recreates the container. The owner runs it once with `sudo bash`. Order matters: a new image that selects a column the database does not have yet breaks the pages that touch it.

**Read-only look at production data without handling a password:** pipe a small Node script into the app container, which already holds `DATABASE_URL`:
```bash
ssh -p 2022 nutnet@192.168.0.10 "/usr/local/bin/docker exec -i fun-app node" < check.js
```

---

## 6. Rules and traps (consolidated from Claude's working memory, 2026-09-13)

Each item is here because something broke or nearly broke. Keep them.

### 6.1 Security — fail closed (review of 2026-09-12)
- `authEnabled` is `process.env.AUTH_DISABLED !== "1"`, and middleware reads the same switch. It used to switch itself off when the LINE Login env vars were empty, and `requireRole`/`requirePerm` hand out **admin** when auth is off — one lost env file would have published every record. `docker-compose.yml` deliberately does not pass `AUTH_DISABLED`; do not add it.
- Never write `if (process.env.SECRET && value !== process.env.SECRET)`: an unset secret then means "everyone in". Use `checkWebhookKey()` in `src/lib/apiKey.ts` (timing-safe, refuses when unset). The SSO token check in `src/lib/sso.ts` follows the same rule.
- Every endpoint a customer can call without logging in gets a limit from `src/lib/rateLimit.ts` (in-process, fixed window, resets on restart). Keep per-IP budgets loose — a showroom or event shares one wifi address — and let per-phone or per-lead budgets do the real work.
- Middleware public paths match on a `/` boundary, never a bare prefix. `/api/models` and `/api/brands` are public for GET/HEAD only.
- `/api/users` gives phone, LINE userId, username, SPS user id and permission matrices to manager+ only. Sales-facing pickers need only name, role and branch.
- Any value that goes into an SPS URL must be an integer — SPS concatenates raw request values into SQL.

### 6.2 Permissions
- Every route that writes or exports calls `requirePerm(menuKey, flag)`: POST→`add`, PUT/PATCH→`edit`, DELETE→`del`, forfeit/lost/cancel→`cancel`, CSV/PDF export→`report`. Plain `requireRole` is for reads.
- Admin is never gated, so the role that fixes permissions cannot lock itself out.
- A new menu needs all four together: `MENU_DEFS`, `ROLE_DEFAULT_PERMS`, the path→menu map, and the settings landing map in `src/lib/menuAccess.ts`.
- Role defaults reproduce the pre-2026-09-09 behaviour exactly; the one-time "แปลงสิทธิ์รูปแบบเก่า" button migrates the old JSON overrides.

### 6.3 Branch scoping
- `managerAllowedBranchIds(funUserId)` = branch links + home branch. A manager with **no** links falls back to seeing everything rather than being locked out.
- Direct lead queries filter `branchId in scope`; queries through a lead relation filter `lead: { branchId: { in: scope } }`; tables with no relation get a manual join in code.
- `requireLeadAccess` scopes sales to their own leads and managers to their branches (the manager half was added 2026-09-12 — before that a manager could open any lead by id). `viewall` lifts both.
- Candidate lists for reassigning or target-setting are scoped to the lead's brand and the viewer's branches, never company-wide.
- Reads and writes may legitimately differ (events are visible to all, editable by owners).

### 6.4 LINE
- The per-brand OA's `destination` is **auto-detected** from the webhook signature on first contact (`resolveLineCreds` in `src/lib/lineConfig.ts`). LINE's console exposes no copyable bot user id; the admin page asks only for access token + channel secret. Never reintroduce a manual "Bot User ID" field — it was built twice and was wrong both times.
- `channel_access_token` must stay `TEXT`; newer LINE tokens exceed 255 characters.
- In the LINE webhook, any "is this sender a staff account" check must run **after** resolving the message to a lead. Running it before silently dropped the owner's own test replies for days.
- A LINE `bot/profile` 404 means the account is not currently a friend of that OA — expected after testing several brands' QRs on one phone, not a bug.

### 6.5 SPS link
- **SPS has no brand or company context of its own.** Its only tenancy dimension is the branch (`branch.branch_id`); `login.php` derives the brand from `branch.sto_br_id`. So the booking handoff sends the **lead's** branch via `fun_branch.dms_branch_id`, and SPS must hop through `login.php?program=sales system&branch=<id>&goto_sps_booking=yes&…`. SPS's `booking_form.php` re-reads branch and brand from the `prospectcontact` row at save time, so the `pros_id` must be SPS's own prospect in that branch.
- **Vehicle catalogue:** SPS owns it; Ch.Lead FUN mirrors nameplate → colour one way (`src/lib/dms/reader.ts`, SELECT only; `src/lib/jobs/dmsCatalogSync.ts`). SPS has no API for it, which is why this reads MySQL directly like CPT does. Variants and prices are deliberately not imported. SPS's `st_id` is the active flag (1/3 active, 2/4 retired). Mirrored rows are read-only here and are deactivated, never deleted. Requires `DMS_MYSQL_URL` and each brand's `dms_brand_id`.
- **SSO:** opaque 32-byte tickets, SHA-256 stored, 60-second single-use, verified server-to-server with `X-Api-Token`. Identity join is `line_userid` first (SPS uses the same LINE Login channel), then `dms_user_id`.

### 6.6 Quotation PDF (`src/lib/quotePdf.tsx`)
- Never put `letterSpacing` on Thai text — it clips characters.
- Route all text through the `<T>` wrapper: SARA AM (ำ) must be fed as its decomposed pair or the last glyph of the line is clipped. Font is Noto Sans Thai.
- Customer links serve the PDF as an attachment (LINE's in-app browser cannot show it inline); the staff redirect adds `?inline=1`.
- The accent colour changed four times in one week — read the `ACCENT` constant rather than trusting any note. Disclaimer is flowing content on the last page, not a fixed footer; each section is `wrap={false}`.

### 6.7 Database
- A status-like column must be a real Prisma enum **or** a VARCHAR in MariaDB — never ENUM in the database with `String` in Prisma (P2032).
- Short VARCHAR reason columns reject longer literals and roll back the whole transaction: `fun_lead_pool.entered_reason` (15), `fun_assignment_history.reason` (20), `fun_lead_stage_history.from_stage/to_stage` (20), `fun_sla_event.event_type` (25) / `resolution` (20). Count characters before adding a new value, and wrap multi-table transactions in try/catch with a server-side log.
- Thai text with emoji through the mysql client needs `--default-character-set=utf8mb4`.
- `mysql -p < file.sql` swallows the first line of the file as the password — pass the password another way.

### 6.8 Front-end
- `inputCls` in `src/components/ui.tsx` contains `w-full`, which beats any fixed `w-*` added next to it. Size such inputs with a wrapper `<div className="w-32 shrink-0">`.
- Do not put `overflow-hidden` on the `Chrome.tsx` shell: it breaks `position: sticky` everywhere below it. Clip the one child that needs it instead, as `Sidebar.tsx` does.

### 6.9 Deploy
- The image tag must be **`fun:latest`** — compose runs that tag. A build tagged anything else loads "successfully" and changes nothing.
- Always pass `NEXT_PUBLIC_BUILD_VERSION` or the version footer goes blank.

### 6.10 Working environment
- The owner's terminal is **Windows PowerShell 5.1**: `&&` is a parse error. Use `;` or separate lines.
- A **cloud** Claude Code session sees only the git repo: no NAS, no production database, no `D:\adamsps`, no CPT project, so it cannot deploy or verify. Use it for code and docs only.
- **Remote Control** (driving the local session from the phone) is switched on by a button inside the Claude desktop app on the session itself, not by the `claude --remote-control` CLI flag. A bridged session shows `bridgeSessionId` in `~/.claude/sessions/<pid>.json`.

---

## 7. Not built yet / open threads

- **Credential rotation:** the MariaDB password (shared by `root` and `n8n_fun`) and an old admin temp password are in git history. Rotate, then change `docker-compose.yml` to read `DATABASE_URL` from `.env`.
- **SPS side of the link:** `sso_land.php`, the "Lead FUN" menu in SPS, and the prospect creation on handoff belong to the DMS team — `docs/SPS_INTEGRATION.md` §0.
- **Catalogue sync switch-on:** waiting for a SELECT-only MySQL account on `adam_prod`.
- **`dms_user_id`** not filled for any user yet; SSO can already match on `line_userid`.
- **Chat response SLA (ADR-016):** drafted, deliberately deferred by the owner, now buildable. Extend the existing SLA engine (`fun_sla_rule.chat_response_minutes`, event type `chat_response_breach`) rather than building a parallel system.
- **Price catalogue / variants:** not imported by choice; quotations stay manually priced.
- **Voice notes, forgot-password flow, SPS parallel-run tracking (ADR-013):** not started.
- **Meta Lead Ads:** app review approved and published; one Page subscribed to `leadgen`. Instant Forms not yet exercised end to end.

---

## 8. Reference documents

- `docs/STATUS.md` — live state; the entry point for any new session
- `TASK_30_RECAP.md` … newest `TASK_NN_RECAP.md` — per-session change logs (root copies are authoritative; the `docs/` copies of 30–34 are older snapshots)
- `docs/SPS_INTEGRATION.md` — SPS contract and handover
- `prospect2-adr-log.md` — ADRs, **authoritative over the handoff text when they conflict**
- `prospect2_handoff.md`, `prospect2-schema-design.md`, `prospect2-glossary.md` — original spec and terms
- `ch_lead_fun_handoff.md` — the very first FB-intake-only spec, mostly superseded
- `README.md` — feature-level description of the codebase
