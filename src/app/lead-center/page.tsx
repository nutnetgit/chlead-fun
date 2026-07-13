"use client";

// Lead Center (ศูนย์รวม Lead) — manager view of every active lead grouped by the
// responsible salesperson: per-person workload summary + filterable table.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { ContactPanel } from "@/components/ContactPanel";

const PER_PAGE = 20;

function Pager({ page, setPage, total }: { page: number; setPage: (p: number) => void; total: number }) {
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (total <= PER_PAGE) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-[.78rem] text-[var(--text-2)]">
      <span className="num">{(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} จาก {total}</span>
      <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
        className="p-1.5 rounded-lg border border-[var(--border-2)] bg-white disabled:opacity-40 hover:bg-[var(--surface-2)]"><ChevronLeft size={14} /></button>
      <span className="num font-medium">{page}/{pages}</span>
      <button onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages}
        className="p-1.5 rounded-lg border border-[var(--border-2)] bg-white disabled:opacity-40 hover:bg-[var(--surface-2)]"><ChevronRight size={14} /></button>
    </div>
  );
}

type LeadRow = {
  leadId: number; ownerUserId: number | null; ownerName: string | null;
  customerName: string; brand: string; branch: string; modelInterest: string | null;
  temperature: string | null; temperatureConflict: boolean; aiScore: number | null;
  stage: string; daysIdle: number; nextActionAt: string | null; lastActivity: string | null;
};

const STAGE_TH: Record<string, string> = {
  new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรอง", appointment: "นัดหมาย",
  test_drive: "ทดลองขับ", negotiation: "ต่อรอง", finance_check: "ไฟแนนซ์", booking: "จอง",
  nurture: "เลี้ยงต่อ", lost: "เสีย", forfeited: "ถูกริบ",
};
const TEMP_CLS: Record<string, string> = {
  hot: "bg-[var(--red-soft)] text-[var(--red)]",
  warm: "bg-[var(--amber-soft)] text-[var(--amber)]",
  cold: "bg-[var(--bg)] text-[var(--text-3)]",
};

export default function LeadCenterPage() {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("");
  useEffect(() => { setPage(1); }, [ownerFilter, showArchived, brandFilter]);

  const load = () => { fetch(`/api/leads?filter=${showArchived ? "archived" : "all"}`).then((r) => r.json()).then(setRows); };
  useEffect(load, [showArchived]);

  const owners = useMemo(() => {
    const m = new Map<string, { name: string; total: number; hot: number; overdue: number; conflicts: number }>();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const r of rows ?? []) {
      const key = r.ownerUserId === null ? "none" : String(r.ownerUserId);
      const cur = m.get(key) ?? { name: r.ownerName ?? "ยังไม่มีเจ้าของ", total: 0, hot: 0, overdue: 0, conflicts: 0 };
      cur.total++;
      if (r.temperature === "hot") cur.hot++;
      if (r.nextActionAt && new Date(r.nextActionAt) < today) cur.overdue++;
      if (r.temperatureConflict) cur.conflicts++;
      m.set(key, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [rows]);

  // Brand chips only matter (and only render) when the data actually spans
  // more than one brand — a single-brand viewer never sees an empty filter bar.
  const brands = useMemo(() => [...new Set((rows ?? []).map((r) => r.brand))].sort(), [rows]);

  const filtered = (rows ?? []).filter((r) =>
    (!ownerFilter || (ownerFilter === "none" ? r.ownerUserId === null : String(r.ownerUserId) === ownerFilter)) &&
    (!brandFilter || r.brand === brandFilter));

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-[1.7rem]">ศูนย์รวม Lead</h1>
          <button onClick={() => setShowArchived((v) => !v)}
            className={`text-[.78rem] px-3 py-1.5 rounded-full border font-medium transition ${
              showArchived ? "bg-[var(--amber-soft)] border-[var(--amber)] text-[var(--amber)]" : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
            📦 {showArchived ? "กำลังดูที่เก็บเข้าคลัง" : "แสดงที่เก็บเข้าคลัง"}
          </button>
        </div>
        <p className="text-[var(--text-2)] text-[.95rem]">
          {showArchived ? "Lead ที่เก็บเข้าคลัง (ปิดการขายไปนาน) — เก็บไว้เช็คย้อนหลัง ไม่ถูกลบ" : "Lead ทั้งหมดแยกตามเซลส์ผู้รับผิดชอบ — กดการ์ดเพื่อกรองตาราง"}
        </p>
      </div>

      {brands.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[var(--text-3)]">ยี่ห้อ</span>
          {brands.map((b) => (
            <button key={b} onClick={() => setBrandFilter(brandFilter === b ? "" : b)}
              className={`text-[.76rem] px-3 py-1 rounded-full border transition ${
                brandFilter === b ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                                  : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
              {b}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {owners.map(([key, o]) => (
          <button key={key} onClick={() => setOwnerFilter(ownerFilter === key ? "" : key)}
            className={`text-left bg-white border rounded-xl px-4 py-3 shadow-[var(--shadow)] transition ${
              ownerFilter === key ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)] hover:border-[var(--text-3)]"}`}>
            <div className="text-[.78rem] font-medium truncate">{o.name}</div>
            <div className="text-xl font-semibold num">{o.total}</div>
            <div className="text-[.66rem] flex gap-1.5 flex-wrap mt-1">
              <span className="bg-[var(--red-soft)] text-[var(--red)] rounded-full px-2 py-0.5 font-medium">HOT {o.hot}</span>
              {o.overdue > 0 && <span className="bg-[var(--amber-soft)] text-[var(--amber)] rounded-full px-2 py-0.5 font-medium">ค้าง {o.overdue}</span>}
              {o.conflicts > 0 && <span className="text-[var(--amber)]">⚠ {o.conflicts}</span>}
            </div>
          </button>
        ))}
      </div>

      <ContactPanel leadId={selected} onClose={() => setSelected(null)} onArchiveChange={load} />
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base">{ownerFilter ? `Lead ของ ${owners.find(([k]) => k === ownerFilter)?.[1].name ?? ""}` : "Lead ทั้งหมด"} ({filtered.length})</h3>
          <div className="flex items-center gap-3">
            {ownerFilter && <button onClick={() => setOwnerFilter("")} className="text-[.76rem] text-[var(--accent-text)] hover:underline">ล้างตัวกรอง</button>}
            <Pager page={page} setPage={setPage} total={filtered.length} />
          </div>
        </div>
        {rows === null ? <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="py-2 px-5">ลูกค้า</th><th className="py-2 pr-3">เซลส์</th>
                  <th className="py-2 pr-3">แบรนด์/รุ่น</th><th className="py-2 pr-3">Temp</th>
                  <th className="py-2 pr-3">สถานะ</th><th className="py-2 pr-3">ค้าง (วัน)</th>
                  <th className="py-2 pr-5">activity ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE).map((r) => (
                  <tr key={r.leadId} onClick={() => setSelected(r.leadId)}
                    className={`border-b border-[var(--border)] last:border-0 cursor-pointer transition ${selected === r.leadId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
                    <td className="py-2.5 px-5 font-medium whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">{r.customerName}
                        {r.temperatureConflict && <AlertTriangle size={12} className="text-[var(--amber)]" />}</span>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">{r.ownerName ?? <span className="text-[var(--red)]">ไม่มีเจ้าของ</span>}</td>
                    <td className="py-2.5 pr-3">{r.brand}{r.modelInterest ? ` · ${r.modelInterest}` : ""}</td>
                    <td className="py-2.5 pr-3">
                      {r.temperature ? <span className={`text-[.62rem] font-semibold px-2 py-0.5 rounded-full ${TEMP_CLS[r.temperature]}`}>{r.temperature.toUpperCase()}</span> : <span className="text-[var(--text-3)] text-[.7rem]">—</span>}
                    </td>
                    <td className="py-2.5 pr-3">{STAGE_TH[r.stage] ?? r.stage}</td>
                    <td className={`py-2.5 pr-3 num ${r.daysIdle > 7 ? "text-[var(--red)] font-medium" : ""}`}>{r.daysIdle}</td>
                    <td className="py-2.5 pr-5 text-[.78rem] text-[var(--text-2)] max-w-[16rem] truncate">{r.lastActivity ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-3 border-t border-[var(--border)]">
          <Pager page={page} setPage={setPage} total={filtered.length} />
        </div>
      </div>
    </div>
  );
}
