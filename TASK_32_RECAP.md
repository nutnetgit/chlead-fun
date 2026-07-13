# Task #32 Recap: Dashboard v2, mobile polish batch, Conversion Rate settings, Chat redesign

**Status:** ✅ DEPLOYED (2026-07-11), except one item explicitly NOT done (see §6) and one bug under active investigation (see §7)

**Live at:** https://fun.ch-erawan.com — Dashboard, `/chat`, `/settings/conversion-rates`, and a batch of mobile/terminology fixes across the app

---

## 1. Business Logic

### Why this batch
Continuation of the same session as Task #31 (chat + permissions). After that deployed, live testing on mobile surfaced UI papercuts, and the user asked for a brainstormed Dashboard redesign ("ทุกตัวเลขต้องนำไปสู่การกระทำของ ผจก. ได้" — every number must lead to a manager action, not vanity metrics) plus groundwork for a future Weighted Pipeline Run Rate forecast.

### Dashboard v2 — Action Zone + Team Scorecard
Approved brainstorm framework: a manager dashboard should answer 4 questions. Built for the first two (highest impact):
- **① Action Zone** (top of page, only renders sections that have something to act on): pending SLA escalations with inline "เตือนอีกครั้ง"/"ย้ายเข้า pool"/"ยกเว้น" buttons (web-side twin of the LINE escalate card, see `/api/governance/sla-action`), unanswered customer chats (pulls from `fun_chat_message` — latest message per lead is inbound = unanswered), HOT leads idle >7 days, unclaimed pool count with oldest-waiting age. Shows a green "✅ ไม่มีเรื่องค้าง" banner when empty instead of empty sections.
- **② Team Scorecard**: per-salesperson table (leads held, overdue count, avg first-response time in a 90-day cohort, activities/day over 7 days, bookings this month, conversion % in the 90-day created-cohort), sorted worst-first (most overdue, then slowest response) so problems surface without scrolling.
- **③** Funnel + temperature split + recent SLA events — kept unchanged from v1.

Deliberately **not** built (per the brainstorm's "no vanity metrics" rule): all-time totals, brand-share pie charts, anything without a clear next action.

### Conversion Rate / Weighted Pipeline settings (groundwork only)
User proposed a two-part design for a better Run Rate forecast: (1) **Lead Aging** — a HOT lead idle >14 days should auto-downgrade to WARM (buying intent decays with time; today temperature never decays on its own), (2) **Weighted Pipeline** — forecast = Σ(open leads in each tier × that tier's close probability), e.g. 10 HOT × 20% + 20 WARM × 10% ≈ 4 expected bookings. Built the settings page (`/settings/conversion-rates`) for the configurable knobs (HOT/WARM/COLD probability %, aging threshold days) with a live preview calculation. **The actual calculation is NOT wired into Dashboard or Run Rate yet** — this page only persists the assumptions. See §6.

### Chat redesign
Live-tested `/chat` felt too sparse and didn't match LINE's own conventions, and had no mobile layout at all (two-pane squeezed together). Rebuilt: circular avatar (deterministic color from name hash, not random — so it doesn't flicker on re-render), last-message preview instead of brand/branch, relative date top-right (วันนี้/เมื่อวาน/dd-mm via new `fmtRelativeDay()` in `src/lib/date.ts`), unread count as a green filled circle with white number (real count — messages since the last outbound reply — not just a boolean dot like before). Mobile: only one pane renders at a time now (list, or thread with a back button), matching how LINE's own app behaves on a phone.

### Six smaller mobile/consistency fixes
1. Header user chip collapses to just the avatar circle below the `sm` breakpoint (name text was wrapping/overflowing on mobile)
2. "ตั้งค่า" (Settings) section hidden from the mobile drawer nav entirely — not needed there
3. `ContactPanel.tsx`'s close (X) and archive buttons spaced further apart — a live bug report: on mobile they were close enough that a close-tap could land on archive by mistake
4. "ลีด" → "Lead" (English) everywhere in the UI, matching "Pipeline" already being English
5. `/leads` pipeline page's 4 summary cards are now clickable — filters the list view by ในลิสต์นี้/ต้องตามวันนี้/เกินกำหนด/AI ขัดแย้ง
6. Clicking a lead in the Pipeline list view now shows the same field-level detail Lead Center's `ContactPanel` shows (owner, next action, created date, budget range — previously missing from Pipeline's own inline detail panel)

---

## 2. Database Schema

**No new migrations this batch.** `/settings/conversion-rates` reuses the existing generic `Setting` key-value table (`getSetting`/`setSetting` from `src/lib/settings.ts`) under key `"conversionRates"` — same pattern as `lineQuota` and `automation`. Dashboard v2's new queries (Action Zone, Scorecard) are all reads against existing tables (`SlaEvent`, `Lead`, `LeadPool`, `ChatMessage`, `Activity`, `LeadStageHistory`) — no schema changes needed.

---

## 3. UI Design

- **`/dashboard`** (`src/app/dashboard/page.tsx` + `src/app/api/dashboard/route.ts`): restructured per §1 above. Action Zone cards only render when non-empty; color-coded by urgency (red border = escalations, amber = unanswered chats). Scorecard table row highlights `bg-[var(--red-soft)]/40` when a salesperson has ≥3 overdue leads.
- **`/settings/conversion-rates`** (new page): 3-input percentage grid (HOT/WARM/COLD) with a live-computed example sentence below, plus a separate card for the aging-days threshold. Explicit note at the bottom of the page stating the calculation isn't connected yet (so nobody mistakes the settings existing for the feature working).
- **`/chat`**: see §1 — full visual rework, mobile-first pane switching.
- Mobile fixes: see §1 items 1-3.

---

## 4. API Endpoints

### New
- `POST /api/governance/sla-action` — web-side twin of the LINE SLA-escalate card's buttons, so a manager can act from the Dashboard instead of hunting for the LINE message. Reuses `handleSlaPostback()` from `src/lib/governance.ts` (same function the LINE webhook's postback branch calls) — actor comes from the session (`requireRole`) instead of a LINE userId lookup. Only `nudge_again`/`reassign` are offered here; `exempt` still routes to `/governance/exempt` (needs a mandatory written reason, doesn't fit a one-click button).
- `GET/PUT /api/settings/conversion-rates` — the Weighted Pipeline assumption knobs, `requireRole(["admin","gm"])` on PUT.

### Changed
- `GET /api/dashboard` — now returns `actionZone` and `scorecard` objects alongside the original funnel/temperature/recentEvents payload (backward-compatible superset, nothing removed).
- `GET /api/chat/inbox` — `unread: boolean` replaced with `unreadCount: number` (real count of consecutive inbound messages since the last outbound reply, not just "is the latest message inbound").

---

## 5. Deployment Notes

- No migrations to apply this round.
- Full `npm run build` + `npx tsc --noEmit` clean before deploy (standard gate every batch).
- Deployed via the standard pipeline: tar source → NAS → `docker build --build-arg NEXT_PUBLIC_LIFF_ID=...` → `docker compose up -d --force-recreate app`.
- Verified post-deploy: container starts clean, `[scheduler] in-app hourly cron registered` present in logs, both `http://localhost:3102` and `https://fun.ch-erawan.com` return `307` (expected — redirects to `/login`, not an error).

---

## 6. Explicitly NOT done — Weighted Pipeline calculation

The settings page (§1, §3) only **stores** the HOT/WARM/COLD probabilities and aging threshold. Nothing reads them yet. Two pieces of real logic remain:

1. **Lead Aging auto-downgrade**: a HOT lead idle longer than `hotAgingDays` should flip to WARM automatically. The natural home for this is `src/lib/jobs/sla.ts`'s `runSlaJob()` (already walks every active lead hourly, already has the idle-days calculation available at `idleDays` — see the existing idle-ladder logic around line 108-110 of that file) — was mid-way through re-reading that file for the hook point when this session got interrupted by a live bug report (§7) that took priority.
2. **Weighted Run Rate forecast**: needs a small aggregate query (group active leads by temperature, multiply counts by the configured probabilities, sum) surfaced somewhere — most natural fit is a new card on `/runrate` (`src/app/runrate/page.tsx` + `src/app/api/runrate/route.ts`), pulling the percentages from `/api/settings/conversion-rates`.

Neither is started. This is the next piece of work when resumed.

---

## 7. ⚠️ ACTIVE BUG — customer LINE messages not appearing in `/chat`

**Symptom reported live:** a customer scanned a salesperson's QR, completed registration (new lead correctly appeared in Lead Center — so `/api/public/lead` + LIFF linking worked), but when that same customer sent a follow-up text message to the LINE OA, it never showed up in `/chat`.

**Ruled out so far:**
- `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_CHANNEL_SECRET` are both present and correctly sized in the running container (checked via `wc -c` on the env vars inside the container — 172 and 32 chars respectively, matching expected format).
- The webhook route's message-handling code (`src/app/api/webhooks/line/route.ts`, branch 3 — inbound chat messages) was re-read line by line and looks logically correct: resolves `PersonIdentifier(idType: "line_userid")` → all active leads for that person → fans out one `ChatMessage` row per active lead (or `leadId: null` if unresolved) with dup-checking per `(leadId, lineMessageId)`. No `requireRole` accidentally applied to this route (would have silently rejected every LINE webhook call — checked specifically, not present).
- In LINE Developers Console → Messaging API → Webhook settings: **"Use webhook" toggle confirmed green/ON**, and **Verify button confirmed still returns Success** — ruling out my leading hypothesis (that repeated container restarts during redeploys caused LINE to auto-disable the webhook after delivery failures).

**Not yet checked (next steps for whoever picks this up):**
- Whether **any** row exists in `fun_chat_message` at all for this conversation (would distinguish "webhook never fires for message-type events" vs. "fires but something in the insert path silently fails") — needs a DB query, which requires the user to run it directly (Claude Code's credential-materialization guardrail blocks piping the DB root password into a new command, even for a read-only `SELECT`).
- Whether LINE Official Account Manager's **auto-reply/greeting messages** setting was ever turned off as instructed earlier in the project — if still on, it doesn't block the webhook, but could mean the user is looking at OA Manager's own auto-reply and mistaking it for "no message received" (worth explicitly asking the user to check where exactly they were looking when they said the message "didn't show up").
- Whether the specific test customer's LINE account is the **same one used for the earlier successful end-to-end test** (`liff.state` unwrapping test) — if a *different* fresh account was used this time, worth confirming their `PersonIdentifier(line_userid)` row actually got created (i.e., re-verify the registration→linking step succeeded for *this* customer specifically, not just that "a lead appeared").
- Consider adding a temporary `console.log` at the top of the message-handling branch (event count received, resolved sourceUserId, resolution result) and checking `docker logs fun-app` immediately after the user sends a fresh test message — this is the fastest way to see whether LINE is calling the endpoint at all versus the call succeeding but something downstream failing silently.

**This is the single most important open item** — the customer registration + welcome-push half of the LINE integration is confirmed working end-to-end, but inbound chat (the actual point of building `/chat` in Task #31) is currently unverified/broken in production.

---

## 8. Full outstanding list carried from Task #31 (for reference — items 1-6 below are now done, kept here only as a diff marker)

- ~~Chat UI mobile redesign~~ — ✅ done this batch (§1, §3)
- ~~Pipeline stat cards not clickable~~ — ✅ done this batch
- ~~Manager dashboard redesign~~ — ✅ done this batch (Action Zone + Scorecard; funnel/temperature kept from v1)
- **Weighted pipeline / lead aging for Run Rate** — ⚠️ still not done, see §6 above (settings groundwork done, calculation not wired)
- ~~Mobile spacing (Lead Center X/archive buttons)~~ — ✅ done this batch
- ~~Pipeline lead click → full detail~~ — ✅ done this batch
- ~~Terminology "ลีด" → "Lead"~~ — ✅ done this batch
- ~~Header user chip mobile~~ — ✅ done this batch
- ~~Settings nav hidden on mobile~~ — ✅ done this batch

---

**Build/typecheck clean, deployed and live. Two real open items going into the next session: §6 (Weighted Pipeline calculation, not started) and §7 (inbound chat bug, actively unresolved — start here, it's a regression in a just-shipped feature).**
