# Ch.Lead FUN — **Ch.Erawan Lead Follow-Up Nudger**

Sales lead management for Ch. Erawan Group — replaces the legacy SPS "Prospect"
module. Design source of truth: [prospect2_handoff.md](prospect2_handoff.md) +
[prospect2-adr-log.md](prospect2-adr-log.md) (ADR-001..014 — **authoritative
over handoff body text when they conflict**) + [prospect2-glossary.md](prospect2-glossary.md).

Official system name is **Ch.Lead FUN** (ADR-012b); "Prospect 2.0" is the old
working name still used in some doc filenames/mockups — same system. The
original FB-Lead-Ads-only tool (this repo's earliest commits) is now just one
intake adapter inside this larger system.

**Stack**: Next.js 16.2.9 · React 19 · Tailwind 4 · Prisma 5 (pinned — do not
upgrade to v6) · MariaDB (own DB `ch_lead_fun` on the `mariadb-erawan` server,
host port 3308, internal `mariadb-erawan:3306`) · Docker on Synology DS1621+,
deployed at `http://192.168.0.10:3102` (LAN-only; add Cloudflare Access before
exposing further, or expose select routes via the tunnel — see `fb-meta`/`fb-lead-ingest`).

## Locked architectural decisions

1. **DB isolation**: `ch_lead_fun` is its own database on the shared
   `mariadb-erawan` server — never mixed into `ch_erawan` (holds unrelated
   `mk_*`/`bs_*` tables) or the legacy SPS database. `n8n_fun` user has DML
   rights on `ch_lead_fun.*` only.
2. **n8n = clock, app = brain**: n8n workflows are thin — Schedule Triggers
   that POST to this app's `/api/jobs/*` endpoints with `x-api-key:
   $WEBHOOK_SECRET`. All DB writes, Gemini calls, and LINE pushes happen in
   the app, not in n8n Code/HTTP nodes. Exceptions: WF1 (Meta webhook
   ingress — still being finalized) and the LINE Group-ID capture helper.
3. **Gemini**: this project's own API key/project (not shared with Nong Count).
4. **Don't touch the legacy SPS DB** until explicitly approved (2026-07-06)
   — even read-only. This blocks ADR-012's customer import and ADR-013's
   parallel-run check for now.
5. **ADR-010 (Booking Handoff as a mandatory gate) is 🟡 Proposed, not
   Accepted** — needs a mandate from the business owner. Don't hard-code
   enforcement until it flips to Accepted.

## Schema

Owned by raw SQL, applied in order (`sql/001`..`005`); Prisma
(`prisma/schema.prisma`) only mirrors it — **never `prisma migrate`** here.

- `001_fun_schema.sql` — original 5-table Ch.Lead FUN schema (superseded, see 002)
- `002_prospect2_schema.sql` — the real schema: drops the 3 superseded tables
  (`fun_leads`, `fun_lead_activities`, `fun_nudge_log`), creates 27 new tables
  (groups A–I per `prospect2-schema-design.md`, group F reduced to
  `fun_booking_handoff` — no `fun_booking`/reconcile in this phase), the
  `trg_activity_touch_lead` trigger, and seeds (9 branches, 6 brands, 20
  source channels, 8 lost reasons, 5 loose-month-1 SLA rules)
- `003_branch_code.sql` — adds `fun_branch.branch_code` (joins
  `fun_channel_config.branch_code` → `branch_id`)
- `004_adr011_conflict.sql` — adds `fun_lead.temperature_conflict` +
  `sla_override` to the activity_type enum
- `005_fix_resolution_column.sql` — bug fix: `fun_sla_event.resolution` was
  ENUM in the DB but Prisma declares it plain VARCHAR; writing a value threw
  P2032. Converted to VARCHAR(20).
- `006_enum_to_varchar.sql` — the 005 bug recurred on `fun_activity.outcome`
  (predicted), so this converts **every remaining** DB-ENUM column that Prisma
  models as plain String to VARCHAR in one pass (14 columns across 11 tables).
  Columns modeled as true Prisma enums (stage, temperature, activity_type,
  category, role, ...) stay as DB ENUMs — those match and are safe.
  **Rule going forward: a new status-ish column must either be a real Prisma
  enum or VARCHAR in the DB — never ENUM-in-DB + String-in-Prisma.**
- `007_user_branch.sql` — org structure: `fun_branch.brand_id` (branches
  belong to a brand; the 9 seeded branches backfilled by name prefix, Autopro
  left unbranded) + `fun_user_branch` junction (a user can be allowed into
  multiple branches, flexibly; `fun_user.branch_id` stays as home branch).

29 tables total, live and verified on the NAS.

## App endpoints

Ingest (dedup via `fun_person_identifier` unique (id_type, id_value); repeat
contact reopens the existing lead instead of erroring — see `lib/leads.ts`):
- `POST /api/webhooks/fb-meta` — Meta Lead Ads webhook (signature-verified,
  fetches the lead from Graph API, calls `ingestLead`)
- `POST /api/webhooks/fb-lead-ingest` — same ingest path for non-FB sources
  (walk-in, phone, referral, website), `x-api-key` auth
- `POST /api/webhooks/line` — LINE Group-ID capture only (drop-in for future
  public exposure; the live capture path runs through n8n today, see below)

Scheduled jobs (all `x-api-key: $WEBHOOK_SECRET`, called by n8n Schedule
Triggers — see `n8n/FUN-WF*.json`):
- `POST /api/jobs/score` — nightly Gemini scoring → `ai_score` (0-100) +
  `ai_score_reason`; implements ADR-011's temperature-vs-ai_score conflict
  rule (tier-map ai_score, force Warm + `temperature_conflict=1` when the
  human-set temperature disagrees by more than one tier)
- `POST /api/jobs/nudge` — morning follow-up: Gemini drafts a Thai message,
  pushes copyable text + an action card to the lead's sales LINE group, logs
  `fun_nudge_log`
- `POST /api/jobs/sla` — hourly SLA engine (see below)

Settings UI: `/settings/users` (user + role + flexible multi-branch access —
`/api/users` CRUD incl. branchIds replacement), `/settings/branches`
(branches grouped by brand, code editing — `/api/branches` CRUD), `/channels`
(CRUD on `fun_channel_config`), `/status` (health snapshots n8n writes into
`fun_settings`).

Navigation is a left sidebar (`src/components/Sidebar.tsx`) grouped by role —
งานขาย·เซลส์ / ผู้จัดการ / ตั้งค่า·Admin. The grouping is visual only until
login lands; then sections hide/show by the signed-in user's role
(admin/owner sees all, manager sees their allowed branches, sales sees own
leads only). Mobile gets a floating hamburger + drawer.

## SLA engine (`/api/jobs/sla`)

Implements the handoff §5 idle→nudge→escalate→forfeit playbook, plus
first-response-breach detection:

- Picks the most specific active `fun_sla_rule` per lead (branch- >
  brand- > channel-category- > temperature-specific; see `lib/sla.ts`)
- "Idle" clock = `last_activity_at`, falling back to `created_at`
- Each `(lead, event_type)` breach is logged **once** while unresolved (no
  hourly re-alert spam); a fresh activity after the flagged time
  auto-resolves it as `sales_acted` on the next run
- Forfeit → lead moves to `fun_lead_pool` (priority: hot=2/warm=1/cold=0),
  `owner_user_id` cleared, `fun_assignment_history` logged, any still-open
  nudge/escalate events for that lead resolved as `returned_to_pool`
- Cold leads have no forfeit threshold (§5: "ไม่ริบ→nurture") — this job
  moves them to `status='nurture'` once idle exceeds 2× the escalate
  threshold. **This multiplier is my own extrapolation, not specified in the
  handoff** — adjust in `route.ts` if a real number is decided later.
- First-response breach / idle nudge / idle escalate send **no LINE push**
  (removed 2026-07-15 — they used the single legacy LINE channel, not
  brand-scoped like the rest of the app since 2026-07-12). A manager reads
  these off the Dashboard's Action Zone / scorecard instead; the
  `fun_sla_event` row is the only record and the only notification surface.

Tested end-to-end on the NAS with synthetic leads (backdated
`created_at`/`last_activity_at`): nudge, escalate, forfeit, and the
forfeit→resolve-prior-events step all verified working.

## Governance (§6)

`lib/governance.ts` implements the 3 buttons on the SLA-escalate Flex card
(`buildSlaEscalateBubble` in `lib/flex.ts`):

- **เตือนอีกครั้ง (nudge_again)** — inserts a `fun_activity` (type `note`),
  which the DB trigger uses to reset `last_activity_at` (fresh SLA clock),
  resolves the open `idle_escalate` event as `sales_acted`, pushes an
  immediate reminder to the owning salesperson.
- **ย้ายเซลส์ (reassign)** — unassigns the owner, inserts into
  `fun_lead_pool` (priority by temperature), logs `fun_assignment_history`
  (`reason='manual_by_manager'`), resolves the escalate event as
  `manager_reassigned`. No target salesperson is picked here — that needs a
  person-picker a Flex button can't provide.
- **ยกเว้น (exempt)** — a button tap can't collect free text, so this sends a
  deep link to `/governance/exempt?lead=<id>` instead; the web form there
  requires a manager + a written reason (both enforced server-side —
  `POST /api/governance/exempt`), logs `activity_type='sla_override'` with
  the reason, resolves the event as `exempted` with `exempted_by` set.

All 3 actions are manager/gm-only, checked by looking up the tapper's
`fun_user` row by `lineUserid`.

`/pool` — lists unclaimed `fun_lead_pool` entries (hot-first), lets anyone
assign one to an active salesperson (`POST /api/pool/[id]/claim`), which sets
the new owner, flips a forfeited lead back to `active`, and logs
`fun_assignment_history` (`reason='load_balance'`).

`fun_user` has no admin UI — seed rows via SQL for now
(`display_name, nickname, role, branch_id, line_userid`).

## n8n workflows (all thin: Schedule Trigger → HTTP POST to the app)

| Workflow | Schedule | Calls |
|---|---|---|
| `[FUN] WF2 Score` | daily 23:00 (Asia/Bangkok) | `/api/jobs/score` |
| `[FUN] WF3 Nudge` | daily 08:30 | `/api/jobs/nudge` |
| `[FUN] WF5 SLA Engine` | hourly | `/api/jobs/sla` |
| `[FUN] LINE Group-ID Capture` | webhook | forwards to `/api/webhooks/line` |

WF1 (Meta Lead Ads intake) is being finalized — see
[n8n/README-WF1.md](n8n/README-WF1.md). It owns the FB App Secret/System
User token and does signature verification + Graph API fetch itself before
calling the app's ingest endpoint (unlike WF2/3/5, which are pure clock+POST).

## Dev

```sh
cp .env.example .env    # DB creds, WEBHOOK_SECRET, GEMINI_API_KEY, LINE token, Meta secrets
npm install
npx prisma generate
npm run dev             # http://localhost:3000
```

## Deploy to NAS

```sh
docker build -t fun:latest .
docker save fun:latest | gzip > fun.tar.gz
pscp -P 2022 fun.tar.gz nutnet@192.168.0.10:/volume1/docker/fun/
# on NAS: docker load < fun.tar.gz ; docker compose up -d --force-recreate
```

Gotchas: image tag must match compose (`fun:latest`); **always
`--force-recreate`**, a restart won't pick up a new image; `.env` next to
compose on the NAS must have all secrets (`DATABASE_URL`, `WEBHOOK_SECRET`,
`GEMINI_API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `META_APP_SECRET`,
`FB_SYSTEM_USER_TOKEN`); when adding a new env var reference, remember to
**re-copy `docker-compose.yml` to the NAS too**, not just `.env` — this has
been forgotten more than once.

## Build order status (handoff §7, reprioritized per ADR-014's MVP scope —
## pilot = Mazda สำนักงานใหญ่ branch only, 1 month, before wider rollout)

- [x] 1. Dimensions — branches/brands/channels/lost-reasons/SLA rules seeded
- [x] 2. Customer master (`fun_person`/`identifier`/`consent`) — dedup tested
- [x] 3. Lead core (`fun_lead`/`activity`/`stage_history`) + trigger — tested
- [ ] 4. Legacy import — **scope reduced by ADR-012**: only `customer` →
  `fun_person` for dedup (no lead/activity history import). Blocked: no SPS
  DB/dump access yet, and blocked by the "don't touch legacy DB yet" instruction.
- [x] 5. **SLA engine** — hourly cron, tested end-to-end
- [x] 6. **Governance** — postback handler for the 3 escalate-card buttons
  (`nudge_again`/`reassign`/`exempt`) + `/pool` claiming page + `/governance/exempt`
  deep-link page (mandatory-reason exemption). Tested end-to-end (claim,
  exempt with auth/validation, all API + page responses). **Gap**: real LINE
  postback delivery is untested — needs `LINE_CHANNEL_SECRET` in env (not yet
  set) and at least one real `fun_user` row with a `lineUserid`; the endpoint
  code path skips signature verification with a loud console warning if the
  secret is unset, but should not go live like that.
- [x] 7. AI layer — score + nudge jobs live
- [ ] 8. Commercial + Booking Handoff — tables exist, no endpoints/UI yet.
  **ADR-010's mandatory-gate design is Proposed, not Accepted** — build the
  soft version (generate handoff, no enforcement) until a mandate exists.
- [~] 9. Interface — **Web App DONE**: `/leads` sales workspace (KPI cards,
  2-col list+detail per the teal mockup, activity timeline, AI-draft copy box,
  quick-log modal → `POST /api/leads/[id]/activity`, temperature set buttons,
  ADR-011 conflict badge on both list rows and detail header) + `/dashboard`
  manager page (KPI cards, funnel-by-stage bars, temperature split, recent
  SLA events). Whole app restyled to the ADR-007 teal design language
  (IBM Plex Sans Thai via next/font, palette in globals.css). Root `/` now
  redirects to `/leads`. **LINE digest + quick-log for sales still TODO**
  (needs fun_user rows + LINE_CHANNEL_SECRET first anyway).
- [ ] 10. Analytics — `fun_kpi_daily` pre-aggregate — not started
- [ ] 11. FB Lead Ads intake adapter — WF1 close to done, blocked on Meta App
  Review / Business Verification (separate from everything else, doesn't
  block 1–10 per the handoff)
