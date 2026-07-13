# Ch.Lead FUN — Claude Code Handoff

> **Project:** Lead Follow-Up Nudger ("Ch.Lead FUN") for Ch. Erawan Group
> **Handoff date:** 2026-07-04
> **Origin:** Full design session in Claude.ai — this file is the single source of truth for that design.
> **Owner:** Nutt (GenAI architect, Ch. Erawan Group)

---

## 0. FIRST TASK — Survey the CATS project

Before writing any code, locate and explore the existing **CATS** project on this machine (ask the user for the path if not found). Produce a short report of reusable assets, specifically:

1. **Facebook connection pattern** — how CATS authenticates (System User token? OAuth flow?), how it stores the token, how it receives/pulls data from Meta Graph API
2. **LINE push pattern** — how CATS sends to LINE groups (Messaging API client code, Flex Message builders, group ID management)
3. **Settings UI** — the screens/components where the user connects Facebook and picks LINE destinations; reuse the same UX so Ch.Lead FUN feels familiar
4. **Tech stack** — framework, DB client, deployment method; **prefer matching CATS' stack** for Ch.Lead FUN unless there's a strong reason not to
5. **Config storage** — how settings are persisted (DB tables? env? JSON?)

Reuse code where license/structure allows; otherwise mirror the patterns. Flag anything in CATS that conflicts with this spec.

---

## 1. Project summary

An internal tool that acts as an **"AI Social Sales Admin"** for the sales teams:

- Pulls leads from **Facebook Lead Ads / Messenger** (multi-page: 6–7 brand pages — Mazda, Ford, Mitsubishi, GWM, Deepal, Kia)
- AI (Gemini) **scores leads** (hot/warm/cold) and **drafts Thai follow-up messages**
- Pushes new leads + morning nudge digests to **LINE groups per branch/brand**
- Salespeople **copy the draft and send it themselves** from their own LINE
- Sales tap buttons to update prospect status → feeds back into the system
- Managers get an auto-updated **Google Sheet**, accumulated week-to-week, with prospect status transitions

### Hard constraints (do not violate)
- **AI never messages customers directly.** AI drafts; a human sends. This is a firm company-wide rule.
- All data stays in the existing `ch_erawan_schema` on Docker MariaDB (**port 3307**) on the Synology DS1621+.
- New tables use prefix **`fun_`** — do NOT touch tables belonging to Nong Count, Staff Bot, or any other project.
- The internal AI agent project is named **Sabai** — if referenced, use only that name.
- Phone numbers must be **masked to last 4 digits** before being sent to any external AI API (PDPA).

---

## 2. Phased plan

| Phase | Orchestration | Web app role |
|---|---|---|
| **1 (build now)** | Existing **n8n.ch-erawan.com** runs all 4 workflows (single instance — decision made: no n8n2) | Settings UI only (connect FB page → LINE group → Google Sheet), writes config to DB; n8n reads config from DB |
| **2** | n8n keeps only cron jobs (scoring, nudge) | App handles FB webhook intake + LINE/Sheets output directly |
| **3 (final)** | **No n8n.** | Standalone app: built-in scheduler, pluggable connectors (TikTok / IG / LINE Ads next) |

**Key architecture decision enabling smooth migration:** the Settings UI writes to `fun_channel_config` etc. in MariaDB from day one. n8n reads config from those tables. In Phase 3 the app simply reads its own config — UI and data never change.

Phase 1 workflow logic, once proven, becomes the spec for the app code in Phases 2–3. Keep n8n workflows small and well-named (`[FUN] WF1 Intake`, etc.) so they translate cleanly to code.

---

## 3. Database schema (create in ch_erawan_schema, MariaDB :3307)

```sql
-- Channel routing: which FB page maps to which brand/branch/LINE group/Sheet
-- (pattern borrowed from Nong Count's group_config — dynamic, no code changes to add a brand)
CREATE TABLE fun_channel_config (
  config_id INT AUTO_INCREMENT PRIMARY KEY,
  fb_page_id VARCHAR(30) NOT NULL UNIQUE,
  fb_page_name VARCHAR(100),
  brand VARCHAR(20) NOT NULL,              -- mazda/ford/mitsubishi/gwm/deepal/kia
  branch_code VARCHAR(10) NOT NULL,
  line_group_id VARCHAR(50) NOT NULL,      -- destination sales LINE group
  gsheet_id VARCHAR(100),                  -- destination spreadsheet (per brand or shared)
  active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE fun_leads (
  lead_id INT AUTO_INCREMENT PRIMARY KEY,
  source ENUM('facebook','messenger','line_oa','walkin','phone','referral','website') NOT NULL,
  fb_leadgen_id VARCHAR(50),               -- Meta leadgen id for dedupe/audit
  fb_page_id VARCHAR(30),
  brand VARCHAR(20) NOT NULL,
  branch_code VARCHAR(10) NOT NULL,
  customer_name VARCHAR(100),
  phone VARCHAR(20),
  line_user_id VARCHAR(50),
  model_interest VARCHAR(50),
  budget_range VARCHAR(50),
  raw_message TEXT,
  score ENUM('hot','warm','cold') DEFAULT NULL,
  score_reason VARCHAR(255),
  status ENUM('new','assigned','contacted','appointment','test_drive','negotiation','won','lost','dormant') DEFAULT 'new',
  assigned_to INT,
  consent_flag TINYINT DEFAULT 0,
  consent_date DATETIME,
  next_followup_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_phone_brand (phone, brand)
);
-- Dedupe policy (lesson from Nong Count UNIQUE KEY bug): repeat inquiry must
-- NOT fail. Use INSERT ... ON DUPLICATE KEY UPDATE status='new',
-- next_followup_date=CURDATE(), updated_at=NOW() and log a reopen activity.

CREATE TABLE fun_lead_activities (
  activity_id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  staff_id INT,
  activity_type ENUM('note','call','line_sent','appointment','test_drive','status_change','ai_draft','reopen'),
  detail TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_leads(lead_id),
  INDEX idx_lead_created (lead_id, created_at)
);

CREATE TABLE fun_nudge_log (
  nudge_id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  staff_id INT,
  draft_text TEXT,
  sent_flag TINYINT DEFAULT 0,
  response_flag ENUM('answered','no_answer','appointment','not_interested') DEFAULT NULL,
  nudge_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES fun_leads(lead_id),
  INDEX idx_nudge_date (nudge_date)
);

-- App-level settings (tokens are referenced, not stored in plaintext — see §7)
CREATE TABLE fun_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

Create a dedicated MariaDB user **`n8n_fun`** with privileges only on `fun_*` tables.

---

## 4. Phase 1 — n8n workflows (build on n8n.ch-erawan.com)

### [FUN] WF1 — Lead Intake (webhook, always on)
- Endpoint `/webhook/fun-lead-fb`: Meta leadgen webhook
  - GET: answer `hub.challenge` for verification
  - POST: verify `X-Hub-Signature-256` (HMAC-SHA256, App Secret) → extract `leadgen_id`, `page_id` → HTTP Request to `GET graph.facebook.com/v21.0/{leadgen_id}?access_token=...` → flatten `field_data`
- Lookup `fun_channel_config` by `page_id` → brand/branch/line_group
- UPSERT into `fun_leads` (see dedupe policy in §3); on reopen, insert `fun_lead_activities` type `reopen`
- Push Flex Message "ลีดใหม่" to the mapped LINE group immediately
- Also expose `/webhook/fun-lead-web` for a walk-in form (Cloudflare Pages, Turnstile-protected)

### [FUN] WF2 — Nightly Scoring (cron 23:00)
- SELECT leads where `score IS NULL` OR status changed today
- Batch 10 leads per Gemini prompt (`gemini-3.1-flash-lite`), **phones masked to last 4 digits**
- Strict JSON out: `{lead_id, score, reason, suggested_next_action}`
- Rules override AFTER AI: test_drive booked → hot; no activity 30 days → dormant

### [FUN] WF3 — Morning Nudge (cron 08:30)
- SELECT leads where `next_followup_date = CURDATE()` AND status NOT IN ('won','lost','dormant')
- Per lead: Gemini drafts a Thai follow-up (≤3 sentences, สุภาพ, ไม่ pushy, reference model + last activity)
- Push Flex carousel to the brand/branch LINE group: lead card + draft + buttons
  `[คัดลอกข้อความ] [โทรแล้ว] [นัดได้] [ไม่สนใจ]`
- Log every draft to `fun_nudge_log`

### [FUN] WF4 — Response Handler + Weekly Sheet (webhook + cron)
- LINE postback → update `fun_nudge_log.response_flag`, `fun_leads.status`, and `next_followup_date`:
  answered → +3 days · no_answer → +1 day · appointment → datetime picker
- **Google Sheets sync** (service account):
  - On every status change: upsert the lead's row in the current week tab
  - Sunday 23:00: create next week's tab (`W{ISO week} {date range}`), carry over all open leads with a `W{n}→W{n+1}` transition column
  - Maintain a `Summary` tab: funnel counts per branch/salesperson, week over week
- Friday 17:00: push weekly summary Flex to the manager LINE group with a link to the Sheet

---

## 5. Phase 1 — Settings web app (minimal)

Cloudflare Pages project (new, do not reuse another project's deployment). Reuse the **Staff Bot registration page structure** and, per §0, the **CATS settings UX** where applicable.

Screens:
1. **Channels** — table of `fun_channel_config`: add/edit FB page → brand → branch → LINE group → Sheet. LINE group IDs can be captured with the same `@groupid` trick used in Nong Count.
2. **Connection status** — show FB token health (call `/debug_token` weekly via n8n and store result in `fun_settings`), LINE bot alive, Sheets service account access OK
3. **(Later)** prompt tuning: editable scoring/drafting prompt text stored in `fun_settings`

Writes go through a small n8n webhook API (`/webhook/fun-config`) with a shared-secret header — no direct DB access from the browser. Protect the whole Pages site behind **Cloudflare Access (Email OTP)**.

---

## 6. External integrations — setup notes

### Facebook (Meta)
- Meta App (Business type) with `leads_retrieval`, `pages_manage_metadata`
- **System User token** from Business Manager (business.facebook.com/settings/system-users), named `n8n-lead-bot`, assigned all brand pages, Full control — this token does not expire
- Subscribe webhook object `Page`, field `leadgen`, to WF1 endpoint
- Test with Meta's **Lead Ads Testing Tool** before running real ads
- Note: Meta retains lead data only ~90 days — webhook-first design, no polling dependence

### LINE
- **New dedicated LINE OA** ("CEA Sales Assistant") — do not reuse Nong Count's channel
- Messaging API: push (Flex), postback events, group join to capture group IDs

### Google Sheets
- **Service account** (Google Cloud project) — share each target spreadsheet with the service account email as Editor
- Store the service-account JSON as an n8n credential (Phase 1) / app secret (Phase 3), never in the DB

### Gemini
- `gemini-3.1-flash-lite` free tier (RPD 500) — shared with Nong Count today, so **monitor daily call count**; if drafting volume grows, move Ch.Lead FUN to its own API key/project
- Phase 3 option: swap to **Sabai** (local Ollama on DS1621+) for drafting — short Thai messages are within local-model capability and keep customer data on-prem

---

## 7. Security & PDPA checklist

- [ ] Verify `X-Hub-Signature-256` on all Meta webhooks
- [ ] Verify `X-Line-Signature` on all LINE webhooks
- [ ] Walk-in form: Cloudflare Turnstile + WAF rate limit
- [ ] Settings UI behind Cloudflare Access Email OTP
- [ ] DB user `n8n_fun` scoped to `fun_*` tables only
- [ ] Tokens/secrets live in n8n credentials (Phase 1) → app secret store (Phase 3); `fun_settings` stores only non-secret config and token *health status*
- [ ] Phone masked to last 4 digits in every AI prompt
- [ ] `consent_flag`/`consent_date` on lead capture; consent notice on FB lead form + walk-in form
- [ ] Monthly cron: anonymize (null name/phone) leads dormant > 12 months

---

## 8. Build order

1. `fun_*` schema + `n8n_fun` user (§3)
2. Survey CATS (§0) → decide app stack → scaffold Settings app skeleton
3. WF1 intake + walk-in form → **start collecting real leads immediately**
4. Meta app + System User token + webhook subscription (§6)
5. WF2 + WF3 (scoring + nudges)
6. WF4 (postbacks + Google Sheets weekly accumulation)
7. Settings UI Channels screen wired to `fun_channel_config`
8. Security checklist pass (§7)

Deliverable of Phase 1 = working end-to-end loop on one pilot brand/branch (suggest starting with the highest-lead-volume page), then roll out to all 6 brands by adding rows in `fun_channel_config` only.
