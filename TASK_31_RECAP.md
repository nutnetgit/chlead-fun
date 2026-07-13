# Task #31 Recap: In-house LINE chat, LIFF-first registration, owner-consent switching, API permission hardening

**Status:** ✅ COMPLETED & DEPLOYED (2026-07-11)

**Live at:** https://fun.ch-erawan.com/chat, /liff/register, and role-hardened APIs across the app

---

## 1. Business Logic

### Why this batch
The original QR flow (`/lead-form` → separate "add friend" button) let a customer submit their info and simply never tap the follow-up button, leaving the lead with no LINE link at all. Live testing surfaced two more real bugs: (a) LINE's LIFF "Bot link" add-friend hand-off drops a plain query string, and (b) a customer with two active leads (different brands/salespeople) had their replies silently routed to only one salesperson. A permission audit separately found that almost every API trusted the sidebar's UI-hiding as its only access control.

### LIFF-first registration ("Mazda Sky Journey" order)
Scan QR → LIFF opens → LINE's "Bot link feature: Aggressive" prompts add-friend automatically → **same page** then shows the registration form (name pre-filled from LINE profile, phone, model, timeframe, PDPA consent) → one submit creates the lead **and** links the verified LINE userId in a single request. Replaces the old two-step flow; retired `src/app/liff/welcome/page.tsx`, `src/app/api/liff/link-follow/route.ts`, `src/lib/liffToken.ts` (the HMAC tamper-guard token existed only to protect a separate "link this line_userid to an existing lead" step that no longer exists).

**Two live-test bugs found and fixed en route:**
- **`liff.state` unwrapping**: LINE wraps the original query string into a nested `liff.state` param during the add-friend hand-off redirect (`?u=19&b=4` arrives as `?liff.state=%3Fu%3D19%26b%3D4`, not auto-expanded). `/liff/register` now unwraps it recursively (handles double-nesting too, so QR codes printed during earlier debugging still resolve).
- **`middleware.ts` gap**: `/liff` and the read-only reference APIs (`/api/models`, `/api/brands`) weren't in the public-route allowlist, so an anonymous customer's LIFF session got redirected to `/login`.

### Welcome message (quota-gated, configurable)
Fires once per registration via the existing quota system (`/settings/automation` → "โควตาข้อความ LINE"). Template (user req 2026-07-10):
```
ช.เอราวัณ ยินดีให้บริการ
ที่ปรึกษาการขายของท่าน
คุณ [ชื่อเซลส์] จาก โชว์รูม [แบรนด์] [สาขา]
เบอร์ติดต่อ [เบอร์]
```
Second bubble appended if the lead came through an event QR with a `linePromoMessage` set. If the push is skipped (toggle off or quota reached), the LIFF page's own "thank you" screen shows the same salesperson name/showroom/phone as page content instead — zero LINE quota cost either way.

### Multi-lead chat fan-out (bug fix, live-test found)
A LINE account is **one** physical conversation, but a customer can legitimately have several active leads at once (different brands, different salespeople). The webhook was resolving inbound messages to only the single most-recently-active lead — the other salesperson never saw the customer's replies. Fixed: inbound messages now fan out to **every** active lead's `/chat` thread. Outbound stays per-lead (unaffected — whoever replies, only their own thread shows their own message).

### Customer-consent ownership switch (new, user-designed)
When a customer who already has an active lead + owner for a brand scans a **different** salesperson's QR for the **same brand**, the system does **not** reassign silently. It creates a pending `fun_owner_switch_request` and sends the customer a LINE Flex message with 2 buttons: "คุยกับ [เซลส์เดิม] คนเดิม" / "เปลี่ยนผู้ดูแลเป็น [เซลส์ใหม่]". The lead's `ownerUserId` is untouched until the customer taps — default (no answer) stays with the original salesperson. Resolved via the LINE webhook's postback handler (a new branch alongside the existing SLA-governance one, since this is customer-initiated, not staff-initiated — bypasses the manager/gm role check that branch requires).

### In-house LINE chat inbox
Staff reply to LINE customers from `/chat` instead of LINE OA Manager. Two-pane layout: conversation list (left) + thread + compose box (right), polling every 5s. Scoped like `/leads` already is — `sales` sees only their own leads' conversations; `manager`/`gm`/`admin` see everything, plus an "ไม่ทราบที่มา" (unresolved sender) bucket for messages from LINE users who never scanned a QR.

### API permission hardening
New `requireRole(allowedRoles)` helper (`src/lib/authz.ts`), session-based (reads `auth()`, not a body-supplied id like the older governance/exempt check did). Applied to: `/api/users` POST/PUT (closes the actual privilege-escalation hole — any authenticated user could previously grant themselves admin or reset anyone's password), `/api/teams*`, `/api/branches*`, `/api/brands*`, `/api/models*`, `/api/sources*`, `/api/channels*`, `/api/quote-options*`, `/api/settings/automation` PUT — all admin/gm-gated to match the sidebar's intended access model. Chat endpoints (`/api/chat/inbox`, `/api/leads/[id]/chat`) use the same helper with ownership scoping (sales can only act on their own leads). Bypasses entirely when auth is disabled (matches `middleware.ts`'s existing soft-launch behavior).

---

## 2. Database Schema

| # | File | What it did |
|---|------|-------------|
| 016 | (already applied, prior session) | `fun_chat_message` table — inbound/outbound LINE messages, deliberately separate from `fun_activity` so customer chatter doesn't spam `last_activity_at`/the SLA idle clock (`trg_activity_touch_lead` unconditionally bumps it on every Activity insert) |
| 017 | `017_chat_message_multi_lead.sql` | Dropped the global `UNIQUE(line_message_id)` — the same inbound LINE message now legitimately gets one row per active lead (multi-lead fan-out fix). Retry-safety moved to an app-level existence check per `(lead_id, line_message_id)` instead of a DB constraint, since a naive composite unique can't express "unique per lead" while `lead_id` is nullable (NULL never equals NULL in a unique index). |
| 018 | `018_owner_switch_request.sql` | New `fun_owner_switch_request` table (`request_id`, `lead_id`, `current_owner_id`, `offered_owner_id`, `status` pending/kept/switched, timestamps) — backs the customer-consent switch flow. |

### Prisma models added
- `ChatMessage` → `fun_chat_message`
- `OwnerSwitchRequest` → `fun_owner_switch_request`

### Known gotcha
`FunUser.phone` was already added in an earlier task — reused here for the welcome message and owner-switch bubbles, no new column needed.

---

## 3. UI Design

### `/liff/register` (`src/app/liff/register/page.tsx`)
Replaces `/liff/welcome`. Same visual language as the old `/lead-form` (gold rounded cards, same PDPA expand pattern, same timeframe chips) but loads inside a LIFF session — name field pre-fills from the LINE profile's display name (still editable). Three "done" states depending on server response: owner-switch pending (asks them to check LINE for the 2-button question), pushed (welcome message sent), or fallback card (salesperson name/showroom/phone shown on-page when the push didn't fire).

### `/chat` (`src/app/chat/page.tsx`)
New sidebar nav item "แชทลูกค้า" (visible to all roles, unlike the ผู้จัดการ-only pages). Left pane: conversation list, unread messages bolded with a dot indicator, unresolved-sender bucket below (manager+ only). Right pane: message bubbles (outbound = gold/right-aligned, inbound = grey/left-aligned, matching `ContactPanel.tsx`'s `fmtDateTime` convention) + compose box, Enter-to-send.

**Known follow-up (flagged by user post-deploy, not yet built):** current layout doesn't have a clear mobile breakpoint — the two-pane layout needs a "back to list" toggle on small screens, and the visual density should move toward a LINE-app-style list (circular avatar, name + last-message preview, right-aligned relative date grouped as today/yesterday/dd-mm, unread count as a green filled circle with white number instead of a plain dot).

---

## 4. API Endpoints

### New
- `GET /api/chat/inbox` — conversation list + unresolved bucket, role-scoped
- `GET/POST /api/leads/[id]/chat` — per-lead thread + send (reuses `linePush()`, already quota-tracked)
- (webhook) LINE postback branch for `keep_owner`/`switch_owner` actions — customer-initiated, no manager/gm gate (that gate is for the existing SLA-escalate governance buttons only)

### Changed
- `POST /api/public/lead` — now accepts `lineUserId` (verified, from `liff.getProfile()`), links it in the same request, detects the same-brand-different-owner conflict and short-circuits into the owner-switch flow instead of silently reopening
- `src/app/api/webhooks/line/route.ts` — new `type: "message"` branch (inbound chat capture, fans out to all active leads), new postback action set for owner-switch
- 8 settings-family routes gated with `requireRole(["admin","gm"])`: users (POST/PUT), teams, branches, brands, models, sources, channels, quote-options, settings/automation

### Retired
- `POST /api/liff/link-follow`, `src/lib/liffToken.ts` — superseded by inline linking in `/api/public/lead`

---

## 5. Deployment Notes

- Migrations `sql/017` and `sql/018` applied live on NAS MariaDB
- Docker image rebuilt with `NEXT_PUBLIC_LIFF_ID` build-arg (unchanged from earlier setup) — this batch is all runtime/server logic, no new build-time env vars
- `npx prisma generate` re-run locally before build to pick up `ChatMessage`/`OwnerSwitchRequest` client types
- Full production build + typecheck clean before deploy

---

## 6. Outstanding / Open Threads

- **Chat UI mobile redesign** — requested post-deploy, not yet built (see §3 above for the exact spec: circular avatars, today/yesterday date grouping, green unread-count badges, LINE-app-style density)
- **Pipeline stat cards not clickable** — `/leads` page's 4 summary cards should filter into a list view (ในลิสต์นี้ / ต้องตามวันนี้ / เกินกำหนด / AI ขัดแย้ง) — requested, not yet built
- **Manager dashboard redesign** — brainstorm requested for team-efficiency-focused metrics, not yet scoped
- **Weighted pipeline / lead aging for Run Rate** — user-proposed design (Hot lead >14 days auto-downgrades to Warm; Run Rate forecast = Σ(tier value × close probability) rather than raw counts) — not yet scoped against the existing ADR-011 temperature-conflict logic
- **Mobile spacing**: Lead Center's close (X) and archive buttons sit too close together on mobile, risk of mis-tapping archive — not yet fixed
- **Pipeline lead click** should open the same full detail view Lead Center uses (`ContactPanel.tsx`) instead of whatever it currently shows — not yet fixed
- **Terminology**: "ลีด" → keep as English "Lead" site-wide (matching "Pipeline" already being English) — not yet done, touches many files
- **Header user chip**: too long on mobile, wraps oddly — should collapse to a circular initials icon on small screens — not yet done
- **Settings nav item**: should be hidden from the mobile bottom/drawer nav entirely (not needed on mobile) — not yet done

---

**All code builds cleanly, all migrations applied successfully, deployed & live on production.**
