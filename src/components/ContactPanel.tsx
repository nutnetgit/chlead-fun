"use client";

// Contact/detail slide-over (CATS-style: click a row → panel slides in from
// the RIGHT over a blurred/dimmed backdrop; click the backdrop to close).
// Reuses the same /api/leads/[id] shape as the /leads workspace. Shows the
// FULL lead record directly (user req 2026-07-08: was a truncated summary
// forcing a click-through to "เปิดหน้ารายละเอียดเต็ม" — now shown here).

import { useEffect, useState } from "react";
import { X, Phone, Archive, ArchiveRestore, Trash2, Inbox, Loader2 } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/date";
import { useMe } from "@/components/Chrome";

type Detail = {
  leadId: number; customerName: string; fullName: string | null; phone: string | null;
  brand: string; brandId: number; branch: string; branchId: number; channel: string; modelInterest: string | null; color: string | null;
  paymentType: string | null; budgetMin: number | null; budgetMax: number | null;
  buyTimeframe: string | null; hasTradein: boolean;
  stage: string; status: string; temperature: string | null; temperatureConflict: boolean;
  aiScore: number | null; aiScoreReason: string | null; ownerUserId: number | null; ownerName: string | null;
  daysIdle: number; nextActionAt: string | null; createdAt: string | null; archivedAt: string | null;
  draft: string | null;
  timeline: { activityId: number; at: string; type: string; direction: string | null; outcome: string | null; summary: string | null; detail: string | null }[];
};
type UserRow = { userId: number; displayName: string; role: string; branchId: number | null; branchIds: number[] };
type BranchRow = { branchId: number; brandId: number | null };

const STAGE_TH: Record<string, string> = {
  new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรอง", appointment: "นัดหมาย",
  test_drive: "ทดลองขับ", negotiation: "ต่อรอง", finance_check: "ไฟแนนซ์", booking: "จอง",
  nurture: "เลี้ยงต่อ", lost: "เสีย", forfeited: "ถูกริบ",
};
const TEMP_TH: Record<string, string> = { hot: "🔥 Hot", warm: "🌤️ Warm", cold: "❄️ Cold" };
const PAYMENT_TH: Record<string, string> = { cash: "เงินสด", finance: "ไฟแนนซ์", undecided: "ยังไม่ตัดสินใจ" };
const TIMEFRAME_TH: Record<string, string> = {
  within_1m: "ภายใน 1 เดือน", m1_3: "1-3 เดือน", m3_6: "3-6 เดือน", over_6m: "เกิน 6 เดือน", unknown: "ไม่ระบุ",
};

const money = (n: number | null) => n === null ? null : n.toLocaleString();

// Manager+ editing controls (user req 2026-07-14: Lead Center was
// effectively read-only for managers — no stage/temperature override, no
// reassign, no way to send a lead back to the pool at all, unlike the
// sales pipeline board which already has all of this). Matches VALID_STAGES
// in /api/leads/[id]'s PATCH handler exactly — "forfeited" is deliberately
// excluded here, it's only ever reached via the dedicated forfeit action.
const STAGE_OPTIONS = ["new", "contacted", "qualified", "appointment", "test_drive", "negotiation", "finance_check", "booking", "nurture", "lost"];

export function ContactPanel({ leadId, onClose, onArchiveChange }: { leadId: number | null; onClose: () => void; onArchiveChange?: () => void }) {
  const me = useMe();
  const [d, setD] = useState<Detail | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingStage, setSavingStage] = useState(false);
  const [savingTemp, setSavingTemp] = useState(false);
  const [reassignTo, setReassignTo] = useState("");
  const [reassigning, setReassigning] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);

  useEffect(() => {
    if (!leadId) { setD(null); return; }
    setD(null);
    setReassignTo("");
    fetch(`/api/leads/${leadId}`).then((r) => r.json()).then(setD);
  }, [leadId]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then(setAllUsers);
    fetch("/api/branches").then((r) => r.json()).then((data) => setBranches(data.branches ?? []));
  }, []);

  if (!leadId) return null;

  // Reassign candidates: sales who sell this lead's brand, further narrowed
  // to the viewing manager's own branches (never company-wide) — the same
  // scoping rule already applied to Lead Pool's assign dropdown and Run
  // Rate's per-sales target editor.
  const role = me?.user?.role;
  const self = allUsers.find((u) => u.userId === me?.user?.funUserId);
  const myOwnBranchIds = new Set([...(self?.branchIds ?? []), ...(self?.branchId ? [self.branchId] : [])]);
  const reassignCandidates = (() => {
    if (!d) return [];
    const brandBranchIds = new Set(branches.filter((b) => b.brandId === d.brandId).map((b) => b.branchId));
    const scopedBranchIds = role === "manager" && myOwnBranchIds.size
      ? new Set([...brandBranchIds].filter((bid) => myOwnBranchIds.has(bid)))
      : brandBranchIds;
    return allUsers.filter((u) => {
      if (u.role !== "sales" && u.role !== "manager") return false;
      const ids = new Set([...(u.branchIds ?? []), ...(u.branchId ? [u.branchId] : [])]);
      return [...ids].some((bid) => scopedBranchIds.has(bid));
    });
  })();

  async function setStage(stage: string) {
    if (!d) return;
    setSavingStage(true);
    await fetch(`/api/leads/${d.leadId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
    });
    setD({ ...d, stage });
    setSavingStage(false);
    onArchiveChange?.();
  }

  async function setTemp(temperature: string) {
    if (!d) return;
    setSavingTemp(true);
    await fetch(`/api/leads/${d.leadId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ temperature }),
    });
    setD({ ...d, temperature, temperatureConflict: false });
    setSavingTemp(false);
  }

  async function reassignOwner() {
    if (!d || !reassignTo) return;
    setReassigning(true);
    await fetch(`/api/leads/${d.leadId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerUserId: Number(reassignTo) }),
    });
    const newOwner = allUsers.find((u) => u.userId === Number(reassignTo));
    setD({ ...d, ownerUserId: Number(reassignTo), ownerName: newOwner?.displayName ?? d.ownerName });
    setReassignTo("");
    setReassigning(false);
    onArchiveChange?.();
  }

  // Send a lead back to the pool (user-reported 2026-07-14: no way in the
  // web app to do this at all — only paths were the hourly SLA idle-forfeit
  // job and a manager tapping the SLA-escalate LINE Flex card's button).
  async function forfeitToPool() {
    if (!d) return;
    if (!confirm(`ริบ "${d.fullName || d.customerName}" เข้า Lead Pool? เซลส์ปัจจุบันจะหลุดจาก Lead นี้ทันที ผู้จัดการคนไหนก็มอบหมายใหม่ได้ที่หน้า Lead Pool`)) return;
    setForfeiting(true);
    const res = await fetch(`/api/leads/${d.leadId}/forfeit`, { method: "POST" });
    setForfeiting(false);
    if (res.ok) {
      setD({ ...d, status: "forfeited", stage: "forfeited", ownerUserId: null, ownerName: null });
      onArchiveChange?.();
    } else alert((await res.json().catch(() => ({}))).error ?? "ริบไม่สำเร็จ");
  }

  async function toggleArchive() {
    if (!d) return;
    setArchiving(true);
    const archived = !d.archivedAt;
    await fetch(`/api/leads/${d.leadId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived }),
    });
    setD({ ...d, archivedAt: archived ? new Date().toISOString() : null });
    setArchiving(false);
    onArchiveChange?.();
  }

  // Permanent delete (user req 2026-07-11) — only offered once already
  // archived, matching the API's own gate; irreversible, so it asks the
  // customer's name back to confirm rather than a plain yes/no.
  async function deleteLead() {
    if (!d) return;
    if (!confirm(`ลบ "${d.fullName || d.customerName}" ถาวร? ลบแล้วกู้คืนไม่ได้ (ประวัติ/แชท/กิจกรรมทั้งหมดจะหายไปด้วย)`)) return;
    setDeleting(true);
    const res = await fetch(`/api/leads/${d.leadId}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) { onArchiveChange?.(); onClose(); }
    else alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
  }

  const budgetRange = d && (d.budgetMin || d.budgetMax)
    ? `${money(d.budgetMin) ?? "?"} - ${money(d.budgetMax) ?? "?"}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/[0.02] backdrop-blur-[2px] fade-in-backdrop" />
      <div
        className="relative w-full sm:w-[440px] shrink-0 bg-white border-l border-[var(--border)] shadow-2xl h-full overflow-hidden slide-panel-right"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-[.86rem] font-semibold">ข้อมูลติดต่อ</h3>
        <div className="flex items-center gap-4">
          {/* Wide gap from the close button (user req 2026-07-10, live report:
              too close together on mobile, "กดแล้วปิด อาจโดนว่ากดทิ้ง" — a
              close-tap landing on archive by mistake). */}
          {d && d.archivedAt && (
            <button onClick={deleteLead} disabled={deleting}
              title="ลบถาวร (เมื่อเก็บเข้าคลังแล้วเท่านั้น)"
              className="p-1.5 rounded-lg text-[var(--red)] hover:bg-[var(--red-soft)] disabled:opacity-40">
              <Trash2 size={15} />
            </button>
          )}
          {d && (
            <button onClick={toggleArchive} disabled={archiving}
              title={d.archivedAt ? "กู้คืนจากคลัง" : "เก็บเข้าคลัง"}
              className="p-1.5 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)] disabled:opacity-40">
              {d.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"><X size={15} /></button>
        </div>
      </div>
      {!d ? <p className="p-4 text-sm text-[var(--text-2)]">กำลังโหลด…</p> : (
        <div className="h-[calc(100%-49px)] overflow-y-auto">
          {d.archivedAt && (
            <div className="px-4 py-2 bg-[var(--amber-soft)] text-[var(--amber)] text-[.74rem] font-medium">
              📦 เก็บเข้าคลังแล้ว ({fmtDate(d.archivedAt)}) — ไม่แสดงในมุมมองทำงานปกติ
            </div>
          )}
          <div className="p-4 border-b border-[var(--border)]">
            <div className="text-[.95rem] font-semibold">{d.fullName || d.customerName}</div>
            {d.phone && (
              <a href={`tel:${d.phone}`} className="flex items-center gap-1.5 text-[.82rem] text-[var(--accent-text)] mt-1">
                <Phone size={13} /> {d.phone}
              </a>
            )}
            <div className="text-[.78rem] text-[var(--text-2)] mt-1.5">
              {d.brand}{d.modelInterest ? ` · ${d.modelInterest}` : ""}{d.color ? ` · สี${d.color}` : ""}
            </div>
            <div className="text-[.74rem] text-[var(--text-3)] mt-0.5">{d.branch} · {d.channel}</div>
          </div>

          <div className="p-4 grid grid-cols-2 gap-2.5 text-[.8rem] border-b border-[var(--border)]">
            {/* Stage/temperature editable here (user req 2026-07-14: Lead
                Center was read-only for these — the sales pipeline board
                already lets a salesperson change both; a manager needs the
                same on behalf of the owning salesperson). Not shown once
                forfeited — that state only changes via ริบ/Lead Pool. */}
            <div>
              <div className="text-[.66rem] text-[var(--text-3)]">สถานะ</div>
              {d.status === "forfeited" ? (
                <div className="font-medium text-[var(--amber)]">{STAGE_TH[d.stage] ?? d.stage}</div>
              ) : (
                <select value={d.stage} disabled={savingStage} onChange={(e) => setStage(e.target.value)}
                  className="w-full text-[.8rem] font-medium bg-transparent border-b border-[var(--border-2)] focus:outline-none focus:border-[var(--primary)] py-0.5 -ml-0.5">
                  {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{STAGE_TH[s] ?? s}</option>)}
                </select>
              )}
            </div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">เซลส์</div><div className="font-medium">{d.ownerName ?? "—"}</div></div>
            <div>
              <div className="text-[.66rem] text-[var(--text-3)]">อุณหภูมิ</div>
              <div className="flex items-center gap-1 mt-0.5">
                {(["hot", "warm", "cold"] as const).map((t) => (
                  <button key={t} onClick={() => setTemp(t)} disabled={savingTemp || d.temperature === t}
                    className={`text-[.68rem] px-2 py-0.5 rounded-full border font-medium transition disabled:cursor-default ${
                      d.temperature === t
                        ? t === "hot" ? "bg-[var(--red-soft)] border-[var(--red)] text-[var(--red)]"
                        : t === "warm" ? "bg-[var(--amber-soft)] border-[var(--amber)] text-[var(--amber)]"
                        : "bg-[var(--surface-2)] border-[var(--border-2)] text-[var(--text-2)]"
                        : "bg-white border-[var(--border-2)] text-[var(--text-3)] hover:border-[var(--text-3)]"}`}>
                    {TEMP_TH[t]}
                  </button>
                ))}
                {d.temperatureConflict && <span title="AI กับที่เซลส์ตั้งไม่ตรงกัน" className="text-[var(--amber)]">⚠️</span>}
              </div>
            </div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">ค้างติดต่อ</div><div className={`font-medium num ${d.daysIdle > 7 ? "text-[var(--red)]" : ""}`}>{d.daysIdle} วัน</div></div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">นัดถัดไป</div><div className="font-medium">{fmtDate(d.nextActionAt)}</div></div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">สร้างเมื่อ</div><div className="font-medium">{fmtDate(d.createdAt)}</div></div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">การชำระเงิน</div><div className="font-medium">{d.paymentType ? PAYMENT_TH[d.paymentType] ?? d.paymentType : "—"}</div></div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">กรอบเวลาซื้อ</div><div className="font-medium">{d.buyTimeframe ? TIMEFRAME_TH[d.buyTimeframe] ?? d.buyTimeframe : "—"}</div></div>
            {budgetRange && <div><div className="text-[.66rem] text-[var(--text-3)]">งบประมาณ</div><div className="font-medium num">{budgetRange}</div></div>}
            {d.hasTradein && <div><div className="text-[.66rem] text-[var(--text-3)]">รถเก่า</div><div className="font-medium">มีรถแลก/เทิร์น</div></div>}
            {d.aiScore !== null && (
              <div className="col-span-2">
                <div className="text-[.66rem] text-[var(--text-3)]">คะแนน AI</div>
                <div className="font-medium">{d.aiScore}/100{d.aiScoreReason ? ` — ${d.aiScoreReason}` : ""}</div>
              </div>
            )}
          </div>

          {/* Reassign / ริบ เข้า pool (user-reported 2026-07-14: no way to
              act on a lead's ownership from the web app at all besides the
              hourly SLA job or a LINE Flex button tap). Hidden once
              forfeited/archived — nothing to reassign/ริบ at that point. */}
          {(d.status === "active" || d.status === "nurture") && !d.archivedAt && (
            <div className="p-4 border-b border-[var(--border)] space-y-2.5">
              <div className="text-[.72rem] text-[var(--text-2)] font-medium">มอบหมาย Lead นี้ใหม่</div>
              <div className="flex items-center gap-2">
                <select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}
                  className="flex-1 text-[.8rem] px-2.5 py-1.5 bg-white border border-[var(--border-2)] rounded-lg">
                  <option value="">เลือกเซลส์...</option>
                  {reassignCandidates.filter((u) => u.userId !== d.ownerUserId).map((u) => (
                    <option key={u.userId} value={u.userId}>{u.displayName}</option>
                  ))}
                </select>
                <button onClick={reassignOwner} disabled={!reassignTo || reassigning}
                  className="px-3 py-1.5 rounded-lg text-[.78rem] font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95 disabled:opacity-50 shrink-0">
                  {reassigning ? <Loader2 size={13} className="animate-spin" /> : "มอบหมาย"}
                </button>
              </div>
              <button onClick={forfeitToPool} disabled={forfeiting}
                className="flex items-center gap-1.5 text-[.76rem] font-medium text-[var(--red)] hover:bg-[var(--red-soft)] rounded-lg px-2.5 py-1.5 disabled:opacity-50">
                {forfeiting ? <Loader2 size={13} className="animate-spin" /> : <Inbox size={13} />}
                ริบ Lead เข้า Pool (ถอดเซลส์ปัจจุบันออก)
              </button>
            </div>
          )}

          {d.draft && (
            <div className="p-4 border-b border-[var(--border)]">
              <div className="text-[.72rem] text-[var(--text-2)] font-medium mb-1.5">ร่างข้อความล่าสุด</div>
              <div className="text-[.78rem] bg-[var(--bg)] rounded-xl p-3 whitespace-pre-line">{d.draft}</div>
            </div>
          )}

          <div className="p-4">
            <div className="text-[.72rem] text-[var(--text-2)] font-medium mb-2">ประวัติการติดตาม ({d.timeline.length})</div>
            {d.timeline.length === 0 ? <p className="text-[.78rem] text-[var(--text-3)]">ยังไม่มีบันทึก</p> : (
              <div className="space-y-2.5">
                {d.timeline.map((t) => (
                  <div key={t.activityId} className="text-[.78rem] border-l-2 border-[var(--border)] pl-2.5">
                    <div className="text-[.66rem] text-[var(--text-3)]">{fmtDateTime(t.at)}{t.direction ? ` · ${t.direction === "inbound" ? "รับเข้า" : "ส่งออก"}` : ""}</div>
                    <div>{t.summary ?? t.type}</div>
                    {t.detail && <div className="text-[.72rem] text-[var(--text-2)] mt-0.5">{t.detail}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
