# Task #34 Recap: Chat inbound bug fix, PDF redesign, QR intake rules, misc UX

**Status:** All changes built + typecheck-clean. Deploy state described in §8 — the earlier batch (delivery-fee schema + first PDF pass) was deployed mid-session; the later batch (chat fix, PDF blue/no-sig/note redesign, quotation-options widths, timeframe→temperature, LINE-name preservation) was built clean and pending final deploy confirmation at recap time.

**Live at:** https://fun.ch-erawan.com

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

## 7. Outstanding / carried forward

- **Chat-response SLA metric** (ADR-016) — now unblocked (chat inbound bug fixed). Deferred until Nutt asks; extend the existing SLA Engine, don't build parallel.
- **Lepas vehicle model lineup** — still placeholders ("Model 1/2/3"), needs real names.
- **Per-brand LINE OA end-to-end** — worth confirming each brand shows real inbound traffic now that the chat filter bug is fixed.
- **Quotation feature** — still no booking-stage auto-transition, no versioning UI.
- **Quotation feature toggle defaults OFF** — check `/settings/quotation-options` master switch before assuming the quote button is live.
