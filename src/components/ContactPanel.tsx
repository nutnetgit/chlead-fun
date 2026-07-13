"use client";

// Contact/detail slide-over (CATS-style: click a row → panel slides in from
// the RIGHT over a blurred/dimmed backdrop; click the backdrop to close).
// Reuses the same /api/leads/[id] shape as the /leads workspace. Shows the
// FULL lead record directly (user req 2026-07-08: was a truncated summary
// forcing a click-through to "เปิดหน้ารายละเอียดเต็ม" — now shown here).

import { useEffect, useState } from "react";
import { X, Phone, Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/date";

type Detail = {
  leadId: number; customerName: string; fullName: string | null; phone: string | null;
  brand: string; branch: string; channel: string; modelInterest: string | null; color: string | null;
  paymentType: string | null; budgetMin: number | null; budgetMax: number | null;
  buyTimeframe: string | null; hasTradein: boolean;
  stage: string; temperature: string | null; temperatureConflict: boolean;
  aiScore: number | null; aiScoreReason: string | null; ownerName: string | null;
  daysIdle: number; nextActionAt: string | null; createdAt: string | null; archivedAt: string | null;
  draft: string | null;
  timeline: { activityId: number; at: string; type: string; direction: string | null; outcome: string | null; summary: string | null; detail: string | null }[];
};

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

export function ContactPanel({ leadId, onClose, onArchiveChange }: { leadId: number | null; onClose: () => void; onArchiveChange?: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (!leadId) { setD(null); return; }
    setD(null);
    fetch(`/api/leads/${leadId}`).then((r) => r.json()).then(setD);
  }, [leadId]);

  if (!leadId) return null;

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
            <div><div className="text-[.66rem] text-[var(--text-3)]">สถานะ</div><div className="font-medium">{STAGE_TH[d.stage] ?? d.stage}</div></div>
            <div><div className="text-[.66rem] text-[var(--text-3)]">เซลส์</div><div className="font-medium">{d.ownerName ?? "—"}</div></div>
            <div>
              <div className="text-[.66rem] text-[var(--text-3)]">อุณหภูมิ</div>
              <div className="font-medium flex items-center gap-1">
                {d.temperature ? TEMP_TH[d.temperature] ?? d.temperature : "—"}
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
