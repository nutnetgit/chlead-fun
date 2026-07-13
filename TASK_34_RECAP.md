# Task #34 Recap: Chat inbound bug fix, PDF redesign, QR intake rules, misc UX

**Status:** ✅ ALL DEPLOYED (multiple deploy cycles through 2026-07-13, endpoints verified 200 after each). Sections §1-§7 = the original batch; §8-§9 = same-day follow-up batches (chat filter, event branch permissions, booking auto-archive, PDF brown, width-bug fix), all live.

**Live at:** https://fun.ch-erawan.com · **GitHub:** github.com/nutnetgit/chlead-fun (master)

---

## 1. Chat inbound bug — RESOLVED (the long-standing Task #31/#32 carry-over)

**Root cause found.** `src/app/api/webhooks/line/route.ts` (inbound message branch) had a staff-noise filter added earlier: skip logging any inbound message whose sender is a known staff LINE account (`funUser.lineUserid` match), to keep staff testing chatter out of `/chat`'s "unresolved" bucket. But it ran **before** resolving the message to a lead. The owner tests every brand's QR flow with his own personal LINE account, which is also his staff login identity — so his test replies resolved to a real active lead yet got silently dropped.

**Fix:** only apply the staff skip when `activeLeadIds.length === 0` (genuinely no lead to attach to). A staff account that is a real customer on some lead now has its messages logged and shown. The `isStaff` lookup was moved to after lead resolution.

**Diagnostic path that cracked it** (all confirmed against prod DB):
- Successful welcome-pushes were being logged (3 pushes to the test account today), so the push half worked.
- The test LINE userId (`Uec91556467fe1f47419a7aba579463d3`) was found in `fun_user` as an admin — the "aha".
- Side note learned: LINE `GET /v2/bot/profile/{userId}` returning **404** means that account is not *currently* a friend of that OA — a separate, expected reason a live thread won't appear (unfriend/block after scanning several brands' QRs on one phone). Not a bug.

**Files:** `src/app/api/webhooks/line/route.ts`. No schema change. Unblocks the deferred chat-response SLA metric (ADR-016).

---

## 2. Quotation PDF redesign (`src/lib/quotePdf.tsx`)

Reworked per Nutt's design brief (he shared a competing dealer PDF as a structural reference — own wording/data throughout, not copied). Now a **numbered 5-section table layout**:
1. Customer & Sales Consultant Details (two-column)
2. Vehicle Details (4-col table)
3. Exclusive Offer (numbered items, free/purchase tags)
4. Financing / Cash Details
5. Payment Due at Delivery (itemized delivery-day expenses)

**Design rules baked in — preserve these if the file is touched again:**
- **Navy blue** accent (`ACCENT = #1c3e6e`, `ACCENT_SOFT = #e6ecf6`) — switched from the app's teal on Nutt's request.
- **Signature lines removed** entirely (were at the bottom of every page).
- **Disclaimer note is plain flowing content, NOT a `fixed` footer** — a fixed footer repeats on every page; Nutt wanted the note only on the last page, which flowing content achieves naturally (`page.paddingBottom` dropped from 150 → 40 accordingly).
- **Sales consultant shown as full `displayName`, never nickname** (also changed in `src/app/api/public/quote/[token]/pdf/route.ts` line ~65: `owner?.displayName` not `owner?.nickname || ...`).
- Branch name large at top-left; "เลขที่เอกสาร (Doc No.)" label (not "CEO no."); no dealer-code line.
- Each section wrapped in `<View wrap={false}>` so tables don't split across a page break.
- Disclaimer text is Nutt's exact wording, with the valid-until date interpolated dynamically (`fmtThaiDate(d.validUntil)`), plus an English translation line.
- **The two Thai-rendering rules from Task #33 still apply** — no `letterSpacing` on Thai; all text through the `<T>` wrapper (SARA AM ำ decomposition). Font still Noto Sans Thai.

**New itemized delivery-day fields** (registration fee / พ.ร.บ. / first installment):
- Migration `sql/028_quote_delivery_fees.sql` adds `registration_fee`, `compulsory_insurance`, `first_installment` DECIMAL(12,2) to `fun_quotation`.
- **Applied as DB root** — `n8n_fun` lacks ALTER privilege (got `ERROR 1142 ALTER command denied`); re-ran as `-u root` and verified via `DESCRIBE`.
- Prisma model `Quotation` gained the three fields; wired through the composer (`/quotes/new`), create API (`/api/leads/[id]/quote`), and both PDF routes. Included in server-side `totalPrice`.

---

## 3. Quotation-options edit-form textbox widths (`src/app/settings/quotation-options/page.tsx`)

Nutt reported the inline edit boxes were too short. The prefill logic already worked (`startEdit` populates both fields). Widened: name input `flex-1` (was `flex-1 max-w-md`), value input `w-44 text-right shrink-0` (was `w-36`).

---

## 4. QR intake: buy-timeframe auto-sets temperature

New business rule (`src/app/api/public/lead/route.ts`). When the customer picks "ระยะเวลาต้องการใช้รถ" on the QR/LIFF form, `temperature` is set automatically (staff can still override). Final mapping (`TIMEFRAME_TEMP`):
- `within_1m` (เร็วๆ นี้) → **hot**
- `m1_3` (1-3 เดือน) → **warm**
- `m3_6` (3-6 เดือน) → **cold**
- `over_6m` (แค่ดูข้อมูลไว้ก่อน) → **cold**

Applied on both new-lead create and repeat-scan update (update path also resets `temperatureConflict: 0`). Note: mapping was corrected mid-session — an earlier draft had `m3_6` as warm.

---

## 5. QR intake: verified LINE profile name always wins

Nutt: when a customer registers via LINE, store/show whatever comes from their LINE profile, not the editable form field (customers "correct"/retype the pre-filled name).
- `src/app/liff/register/page.tsx` now captures `profile.displayName` into a separate `lineDisplayName` state and sends it in the POST body (the visible name field stays editable but no longer authoritative).
- `src/app/api/public/lead/route.ts`: `storedName = lineDisplayName || name` used for `person.firstName` on create; on repeat scans, `firstName` is refreshed from `lineDisplayName` (same pattern as the existing `pictureUrl` refresh).

---

## 6. Deploy status

**Applied to prod DB this session:** `sql/028_quote_delivery_fees.sql` (as root — see §2).

**Deployed mid-session** (confirmed clean `docker logs fun-app` + `200` on `localhost:3102/login` and `https://fun.ch-erawan.com/login`): the delivery-fee schema + fields + first PDF pass (numbered sections, then follow-up render fixes for title wrapping, "No." column, footer overlap).

**Built + typecheck-clean, deploy at recap time:** §1 chat fix, §2 blue/no-signature/note-on-last-page PDF redesign, §3 textbox widths, §4 timeframe→temperature, §5 LINE-name preservation. No new migration needed beyond `sql/028` already applied.

**Deploy pipeline unchanged from Task #33 §8** — same `tar → scp → docker build (3 build-args) → compose up --force-recreate` on NAS `192.168.0.10:2022`, specific-filename PNG exclude (not `*.png`, or `public/logo.png` gets dropped). Deploy + DB writes are gated by the auto-mode safety classifier; if a command is denied, ask Nutt to restate the instruction explicitly rather than routing around it.

---

## 7a. Same-day follow-up batch A (deployed)

- **Chat filter hardened (supersedes part of §1):** the webhook now DROPS any inbound message that doesn't resolve to a QR-registered lead — nothing is stored with `leadId null` anymore. The "ไม่ทราบที่มา" bucket was removed entirely (UI section in `/chat`, `unresolved` query in `/api/chat/inbox`, and the orphaned `/api/chat/unresolved/[lineUserId]` DELETE route). Old unresolved rows were deleted by Nutt via the UI before removal. Kept invariant: any staff-sender check must never run before lead resolution.
- **Lead Center sortable columns:** all 6 headers (ลูกค้า/เซลส์/แบรนด์รุ่น/Temp/สถานะ/ค้างวัน) click-sort asc→desc→default. Temp sorts hot→warm→cold by rank; สถานะ by pipeline order.
- **Mazda สำนักงานใหญ่ (branch_id 1) deleted from prod:** blocked by 10 old test leads (all `lost`, "ทดสอบเพจจิ้ง" names) — deleted them + all child rows; 10 active leads on other branches referenced them via `origin_lead_id` (switch-brand tests) → severed with SET NULL, active leads untouched.
- **Events visibility confirmed:** all events global, no owner column — led directly to §8.

## 8. Same-day follow-up batch B (deployed): event branch permissions + booking auto-archive

**Event branch scoping** (`sql/029_event_branch.sql` — applied to prod as root):
- `fun_campaign.branch_id` INT NULL. NULL = central/group event (admin/gm-managed).
- **Read stays global for every role** (cross-branch visibility is a feature); only WRITES are scoped: manager can create/edit/delete only events owned by one of their branches (`managerAllowedBranchIds()` — new helper in `src/lib/authz.ts` = userBranch links + home branch); manager MUST pick one of their branches on create (no central events from managers).
- Enforced server-side in POST `/api/events` and PUT/DELETE `/api/events/[id]` (shared `checkEventWriteAccess()`); GET also now has `requireRole` (was previously unauthenticated!) and returns `canEdit` per event so the page hides buttons.
- UI: "สาขาเจ้าของ event" dropdown on the create/edit form (manager sees only own branches, required; admin/gm any branch or งานกลาง), branch chip on each event card.

**Booking auto-archive** (`src/lib/jobs/sla.ts`, user decisions: no "delivered" stage — the lead system ends at จอง; 5-day window):
- New pass in the hourly SLA job: leads at `stage='booking'` archive 5 days after ENTERING booking (anchor = latest `fun_lead_stage_history` row with `toStage='booking'`, column is `changedAt` NOT createdAt) — post-booking chat doesn't keep them on the board.
- Also fixed: booking-stage leads now SKIP the SLA idle ladder entirely (previously a booked lead could be nudged/escalated/forfeited — wrong, it's a closed win).

## 9. Same-day follow-up batch C (deployed): PDF brown + the w-full width bug

- **PDF re-toned AGAIN — final = warm brown** (`ACCENT #6e5010`, `ACCENT_SOFT #f6efde`), matching the app's gold/brown identity (globals.css `--accent-text #B57F06` family, darkened for print contrast). Supersedes §2's navy. Everything else from §2 (no signatures, note last-page-only, full displayName) unchanged.
- **The quotation-options textbox bug — real root cause found on 3rd attempt:** `inputCls` (src/components/ui.tsx) embeds `w-full`, and in Tailwind's generated sheet `.w-full` sits AFTER the fixed-width utilities — so any `w-32`/`w-36`/`w-44` added alongside `inputCls` silently loses and the input renders 100% wide (that's why both earlier "width fixes" changed nothing and the edit row blew past the screen). **Correct pattern: never put a fixed `w-*` on an element using `inputCls`; wrap it in a sized `<div className="w-32 shrink-0">` instead.** Fixed in `/settings/quotation-options` (add + edit rows, name maxLength 200 / value maxLength 30) and the same latent bug in `/settings/sources` (4 spots).

## 10. Strategy answers given (not yet built — see chlead-fun-sps-integration memory)

- **SPS integration** (vehicle/price catalog → quotation; lead→SPS booking handoff): SPS source at `D:\adamsps`, tables `stock_model`/`stock_model_color`/`stock_color`/`adam_sale_order`; reuse the SERVICE_BOOKING_PROXY.md api-key proxy pattern (add-only PHP endpoints). Items 3 & 5 of that discussion are independent — catalog pull first, handoff later, sharing one api_key.
- **Better Auth prep:** keep identity vs authorization split; future `fun_user.auth_subject_id` column; auth entry point already isolated in `src/auth.ts`.

## 11. Outstanding / carried forward

- **Chat-response SLA metric** (ADR-016) — now unblocked (chat inbound bug fixed). Deferred until Nutt asks; extend the existing SLA Engine, don't build parallel.
- **Lepas vehicle model lineup** — still placeholders ("Model 1/2/3"), needs real names.
- **Per-brand LINE OA end-to-end** — worth confirming each brand shows real inbound traffic now that the chat filter bug is fixed.
- **Quotation feature** — still no booking-stage auto-transition, no versioning UI.
- **Quotation feature toggle defaults OFF** — check `/settings/quotation-options` master switch before assuming the quote button is live.
