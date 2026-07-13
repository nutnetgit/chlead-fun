"use client";

// Sales workspace (build order §9) — faithful to the approved teal mockup
// (prospect2-sales-web.html): KPI mini cards, 2-column lead list + detail
// panel with timeline, AI draft copy box, and quick-log action bar.
// ADR-011: the ⚠ conflict badge renders on BOTH the list row and the detail
// header — "มองเห็นได้ทุกที่ที่การ์ด lead แสดง".

import { useEffect, useState, useCallback, useMemo } from "react";
import { AlertTriangle, Copy, Check, Loader2, X, Plus, QrCode, Calendar, LayoutList, KanbanSquare, FileText } from "lucide-react";
import { AddLeadModal } from "@/components/AddLeadModal";
import { QrLeadModal } from "@/components/QrLeadModal";
import { KanbanBoard } from "@/components/KanbanBoard";
import { CalendarModal } from "@/components/CalendarModal";
import { useMe } from "@/components/Chrome";
import { fmtDate, fmtDayMonth, fmtDateTime } from "@/lib/date";

type LeadRow = {
  leadId: number; customerName: string; brand: string; branch: string;
  modelInterest: string | null; temperature: string | null; temperatureConflict: boolean;
  aiScore: number | null; stage: string; daysIdle: number; nextActionAt: string | null;
  lastActivity: string | null;
};

type LeadDetail = LeadRow & {
  fullName: string | null; phone: string | null; channel: string;
  color: string | null; paymentType: string | null;
  budgetMin: number | null; budgetMax: number | null; buyTimeframe: string | null;
  hasTradein: boolean; aiScoreReason: string | null; ownerName: string | null;
  createdAt: string | null; draft: string | null;
  quotes: { quoteId: number; quoteNo: string; createdAt: string | null; status: string | null; totalPrice: number | null }[];
  timeline: { activityId: number; at: string; type: string; direction: string | null; outcome: string | null; summary: string | null; detail: string | null }[];
};

const STAGE_TH: Record<string, string> = {
  new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรองแล้ว", appointment: "นัดหมาย",
  test_drive: "ทดลองขับ", negotiation: "ต่อรองราคา", finance_check: "เช็คไฟแนนซ์",
  booking: "จองแล้ว", nurture: "เลี้ยงต่อ", lost: "เสียลูกค้า", forfeited: "ถูกริบ",
};
const TIMEFRAME_TH: Record<string, string> = {
  within_1m: "ภายใน 1 เดือน", m1_3: "1-3 เดือน", m3_6: "3-6 เดือน", over_6m: "เกิน 6 เดือน", unknown: "ไม่ระบุ",
};
const PAYMENT_TH: Record<string, string> = { cash: "ซื้อสด", finance: "จัดไฟแนนซ์", undecided: "ยังไม่ตัดสินใจ" };

function TempBadge({ t, conflict, size = "sm" }: { t: string | null; conflict?: boolean; size?: "sm" | "lg" }) {
  const cls =
    t === "hot" ? "bg-[var(--red-soft)] text-[var(--red)]" :
    t === "warm" ? "bg-[var(--amber-soft)] text-[var(--amber)]" :
    "bg-[var(--bg)] text-[var(--text-3)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full font-semibold ${cls} ${size === "lg" ? "text-[.7rem] px-2.5 py-0.5" : "text-[.62rem] px-2 py-0.5"}`}>
      {(t ?? "N/A").toUpperCase()}
      {conflict && <AlertTriangle size={size === "lg" ? 12 : 10} className="text-[var(--amber)]" />}
    </span>
  );
}

export default function LeadsPage() {
  const [filter, setFilter] = useState<"due" | "all">("due");
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [copied, setCopied] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logType, setLogType] = useState("call_out");
  const [logOutcome, setLogOutcome] = useState("reached");
  const [logSummary, setLogSummary] = useState("");
  const [logNext, setLogNext] = useState("");
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [cardFilter, setCardFilter] = useState<"all" | "today" | "overdue" | "conflict">("all");
  const [aira, setAira] = useState<{ loading: boolean; lines: string[] | null; error: string | null }>({ loading: false, lines: null, error: null });
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [sw, setSw] = useState({ brandId: "", branchId: "", modelId: "", note: "" });
  const [swData, setSwData] = useState<{ brands: { brandId: number; brandName: string }[]; branches: { branchId: number; branchName: string; brandId: number | null; isActive: boolean }[]; models: { modelId: number; modelName: string }[] }>({ brands: [], branches: [], models: [] });

  const me = useMe();
  // Signed-in salespeople see only their own pipeline; managers/admin (and
  // auth-disabled mode) see everything.
  const ownerScope = me?.user?.role === "sales" ? `&owner=${me.user.funUserId}` : "";

  const loadList = useCallback(() => {
    // Kanban needs every active lead regardless of due-filter.
    const effFilter = view === "kanban" ? "all" : filter;
    fetch(`/api/leads?filter=${effFilter}${ownerScope}`).then((r) => r.json()).then((data: LeadRow[]) => {
      setRows(data);
      if (data.length && !data.some((d) => d.leadId === selected)) setSelected(data[0].leadId);
      if (!data.length) { setSelected(null); setDetail(null); }
    });
  }, [filter, selected]);

  const loadDetail = useCallback((id: number) => {
    fetch(`/api/leads/${id}`).then((r) => r.json()).then(setDetail);
  }, []);

  useEffect(() => { loadList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter, ownerScope, view]);
  useEffect(() => { if (selected) loadDetail(selected); setAira({ loading: false, lines: null, error: null }); }, [selected, loadDetail]);

  async function askAira() {
    if (!selected) return;
    setAira({ loading: true, lines: null, error: null });
    const res = await fetch(`/api/leads/${selected}/summarize`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setAira({ loading: false, lines: d.lines, error: null });
    else setAira({ loading: false, lines: null, error: d.error ?? "สรุปไม่สำเร็จ" });
  }

  async function openSwitch() {
    const [br, md] = await Promise.all([
      fetch("/api/branches").then((r) => r.json()),
      Promise.resolve({ models: [] }),
    ]);
    setSwData({ brands: br.brands, branches: br.branches, models: [] });
    setSw({ brandId: "", branchId: "", modelId: "", note: "" });
    setSwitchOpen(true);
    void md;
  }
  useEffect(() => {
    if (!sw.brandId) { setSwData((d) => ({ ...d, models: [] })); return; }
    fetch(`/api/models?brandId=${sw.brandId}`).then((r) => r.json()).then((models) => setSwData((d) => ({ ...d, models })));
  }, [sw.brandId]);

  // Brand chips only matter (and only render) when the data actually spans
  // more than one brand — matches the same pattern already proven in Lead
  // Center (a single-brand viewer never sees an empty filter bar).
  const brands = useMemo(() => [...new Set((rows ?? []).map((r) => r.brand))].sort(), [rows]);
  const brandRows = brandFilter ? (rows ?? []).filter((r) => r.brand === brandFilter) : (rows ?? []);

  const overdue = brandRows.filter((r) => r.nextActionAt && new Date(r.nextActionAt) < new Date(new Date().setHours(0, 0, 0, 0))).length;

  async function copyDraft() {
    if (!detail?.draft) return;
    await navigator.clipboard.writeText(detail.draft).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function saveLog() {
    if (!selected) return;
    setSaving(true);
    await fetch(`/api/leads/${selected}/activity`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        activityType: logType, outcome: logOutcome, summary: logSummary || undefined,
        nextActionAt: logNext ? new Date(logNext).toISOString() : undefined,
      }),
    });
    setSaving(false); setLogOpen(false); setLogSummary(""); setLogNext("");
    loadDetail(selected); loadList();
  }

  const dueLabel = (r: LeadRow) => {
    if (!r.nextActionAt) return { text: "ไม่มีนัด", cls: "text-[var(--text-3)]" };
    const d = new Date(r.nextActionAt); const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    if (d < today) return { text: `ค้าง ${r.daysIdle} วัน`, cls: "text-[var(--red)] font-medium" };
    if (d < tomorrow) return { text: "ตามวันนี้", cls: "text-[var(--accent-text)] font-medium" };
    return { text: `ตาม ${fmtDayMonth(d)}`, cls: "text-[var(--text-3)]" };
  };

  // Stat cards filter the list view (user req 2026-07-10) — client-side
  // subset of whatever `rows` already loaded, not a new API call.
  const cardFilterRows = brandRows.filter((r) => {
    if (cardFilter === "today") return dueLabel(r).text === "ตามวันนี้";
    if (cardFilter === "overdue") return r.nextActionAt && new Date(r.nextActionAt) < new Date(new Date().setHours(0, 0, 0, 0));
    if (cardFilter === "conflict") return r.temperatureConflict;
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[1.7rem]">Pipeline ของฉัน</h1>
          <p className="text-[var(--text-2)] text-[.95rem]">ดูลูกค้าคาดหวังทั้งหมด เปิดประวัติเต็ม และอัปเดตได้ละเอียดกว่าบน LINE</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <button onClick={() => setCalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-[11px] text-[.82rem] border border-[var(--border)] bg-white hover:bg-[var(--surface-2)] transition text-[var(--text-2)]">
            <Calendar size={14} /> {fmtDate(new Date())}
          </button>
          <div className="flex gap-1 bg-[var(--surface-2)] p-1 rounded-full border border-[var(--border)]">
            <button onClick={() => setView("kanban")} title="มุมมองบอร์ด"
              className={`flex items-center gap-1 text-[.74rem] px-3 py-1 rounded-full transition ${view === "kanban" ? "bg-white font-medium shadow-[var(--shadow)]" : "text-[var(--text-2)]"}`}>
              <KanbanSquare size={13} /> บอร์ด
            </button>
            <button onClick={() => setView("list")} title="มุมมองรายการ"
              className={`flex items-center gap-1 text-[.74rem] px-3 py-1 rounded-full transition ${view === "list" ? "bg-white font-medium shadow-[var(--shadow)]" : "text-[var(--text-2)]"}`}>
              <LayoutList size={13} /> รายการ
            </button>
          </div>
          <button onClick={() => setQrOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[11px] text-sm font-medium border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] transition">
            <QrCode size={15} /> QR รับลูกค้า
          </button>
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-[11px] text-sm font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95 transition">
            <Plus size={15} /> เพิ่ม Lead
          </button>
        </div>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {([
          { l: "ในลิสต์นี้", v: rows === null ? "…" : brandRows.length, cls: "", key: "all" },
          { l: "ต้องตามวันนี้", v: rows === null ? "…" : brandRows.filter((r) => dueLabel(r).text === "ตามวันนี้").length, cls: "text-[var(--accent-text)]", key: "today" },
          { l: "เกินกำหนด", v: overdue, cls: "text-[var(--red)]", key: "overdue" },
          { l: "⚠ AI ขัดแย้ง", v: rows === null ? "…" : brandRows.filter((r) => r.temperatureConflict).length, cls: "text-[var(--amber)]", key: "conflict" },
        ] as const).map((c) => (
          <button key={c.l} onClick={() => { setView("list"); setCardFilter(c.key); }}
            className={`text-left bg-white border rounded-xl px-4 py-3 shadow-[var(--shadow)] transition hover:-translate-y-px ${
              view === "list" && cardFilter === c.key ? "border-[var(--primary)] ring-1 ring-[var(--primary)]" : "border-[var(--border)]"}`}>
            <div className="text-[.72rem] text-[var(--text-2)]">{c.l}</div>
            <div className={`text-2xl font-semibold num ${c.cls}`}>{c.v}</div>
          </button>
        ))}
      </div>

      {view === "kanban" && (
        <KanbanBoard
          rows={brandRows as never}
          onMove={async (leadId, stage) => {
            await fetch(`/api/leads/${leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) });
            loadList();
          }}
          onSelect={(leadId) => { setSelected(leadId); setView("list"); }}
        />
      )}

      <div className={`grid grid-cols-1 lg:grid-cols-[.9fr_1.1fr] gap-5 ${view === "kanban" ? "hidden" : ""}`}>
        {/* ── lead list ── */}
        <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden self-start">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-base">ลูกค้าของฉัน</h3>
            <div className="flex gap-1 bg-[var(--bg)] p-1 rounded-full">
              {(["due", "all"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-[.74rem] px-3 py-1 rounded-full transition ${filter === f ? "bg-white font-medium shadow-[var(--shadow)]" : "text-[var(--text-2)]"}`}>
                  {f === "due" ? "ต้องตาม" : "ทั้งหมด"}
                </button>
              ))}
            </div>
          </div>
          {rows === null ? (
            <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p>
          ) : cardFilterRows.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-2)]">{filter === "due" ? "ไม่มีลูกค้าต้องตามตอนนี้ 🎉" : "ยังไม่มี Lead ในระบบ"}</p>
          ) : cardFilterRows.map((r) => {
            const due = dueLabel(r);
            return (
              <button key={r.leadId} onClick={() => setSelected(r.leadId)}
                className={`w-full text-left px-5 py-3.5 flex gap-3 items-center border-b border-[var(--border)] last:border-0 transition ${selected === r.leadId ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-2)]"}`}>
                <div className={`h-[38px] w-[38px] rounded-[10px] flex items-center justify-center text-[.6rem] font-semibold shrink-0 ${
                  r.temperature === "hot" ? "bg-[var(--red-soft)] text-[var(--red)]" :
                  r.temperature === "warm" ? "bg-[var(--amber-soft)] text-[var(--amber)]" :
                  "bg-[var(--bg)] text-[var(--text-3)]"}`}>
                  {(r.temperature ?? "—").toUpperCase().slice(0, 4)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[.88rem] flex items-center gap-1.5 truncate">
                    {r.customerName}
                    {r.temperatureConflict && <AlertTriangle size={12} className="text-[var(--amber)] shrink-0" />}
                  </div>
                  <div className="text-[.76rem] text-[var(--text-2)] truncate">{r.brand}{r.modelInterest ? ` · ${r.modelInterest}` : ""}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`text-[.72rem] ${due.cls}`}>{due.text}</div>
                  <div className="text-[.68rem] text-[var(--text-3)] mt-0.5">{STAGE_TH[r.stage] ?? r.stage}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ── detail panel ── */}
        <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden self-start">
          {!detail ? (
            <p className="p-5 text-sm text-[var(--text-2)]">เลือกลูกค้าจากรายการซ้ายเพื่อดูรายละเอียด</p>
          ) : (
            <>
              <div className="p-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <span className="text-[1.15rem] font-semibold">{detail.fullName || detail.customerName}</span>
                  <TempBadge t={detail.temperature} conflict={detail.temperatureConflict} size="lg" />
                </div>
                <div className="text-[.85rem] text-[var(--text-2)] mt-1">
                  {detail.brand}{detail.modelInterest ? ` ${detail.modelInterest}` : ""}{detail.color ? ` · สี${detail.color}` : ""}{detail.paymentType ? ` · ${PAYMENT_TH[detail.paymentType]}` : ""}
                </div>
                {detail.temperatureConflict && (
                  <div className="mt-2 text-[.76rem] bg-[var(--amber-soft)] text-[var(--amber)] rounded-lg px-3 py-2">
                    ⚠ AI ประเมินต่างจากที่ตั้งไว้ (คะแนน {detail.aiScore}) — {detail.aiScoreReason ?? "ไม่มีเหตุผลบันทึก"} · ระบบปรับเป็น WARM ชั่วคราว
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-5 py-4 border-b border-[var(--border)] text-[.86rem]">
                <div><div className="text-[.7rem] text-[var(--text-3)]">ค้างติดต่อ</div><div className={`font-medium num ${detail.daysIdle > 7 ? "text-[var(--red)]" : ""}`}>{detail.daysIdle} วัน</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">ช่องทางที่มา</div><div className="font-medium">{detail.channel}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">โทร</div><div className="font-medium num">{detail.phone ?? "—"}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">กรอบเวลา</div><div className="font-medium">{detail.buyTimeframe ? TIMEFRAME_TH[detail.buyTimeframe] : "—"}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">สถานะ</div><div className="font-medium">{STAGE_TH[detail.stage] ?? detail.stage}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">รถเทิร์น</div><div className="font-medium">{detail.hasTradein ? "มี" : "ไม่มี"}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">เซลส์</div><div className="font-medium">{detail.ownerName ?? "—"}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">นัดถัดไป</div><div className="font-medium">{detail.nextActionAt ? fmtDate(detail.nextActionAt) : "—"}</div></div>
                <div><div className="text-[.7rem] text-[var(--text-3)]">สร้างเมื่อ</div><div className="font-medium">{detail.createdAt ? fmtDate(detail.createdAt) : "—"}</div></div>
                {(detail.budgetMin || detail.budgetMax) && (
                  <div><div className="text-[.7rem] text-[var(--text-3)]">งบประมาณ</div><div className="font-medium num">{detail.budgetMin?.toLocaleString() ?? "?"} - {detail.budgetMax?.toLocaleString() ?? "?"}</div></div>
                )}
              </div>

              {detail.quotes.length > 0 && (
                <div className="px-5 py-4 border-b border-[var(--border)]">
                  <div className="text-[.72rem] text-[var(--text-2)] font-medium mb-2.5">ใบเสนอราคา ({detail.quotes.length})</div>
                  <div className="space-y-1.5">
                    {detail.quotes.map((q) => (
                      <a key={q.quoteId} href={`/api/quotes/${q.quoteId}/pdf`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-[.8rem] border border-[var(--border)] hover:bg-[var(--surface-2)] transition">
                        <FileText size={14} className="text-[var(--accent-text)] shrink-0" />
                        <span className="font-medium">{q.quoteNo}</span>
                        <span className="text-[var(--text-3)]">{q.createdAt ? fmtDate(q.createdAt) : "—"}</span>
                        {q.totalPrice !== null && <span className="text-[var(--text-2)] num ml-auto">{q.totalPrice.toLocaleString()} บ.</span>}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="px-5 py-4 border-b border-[var(--border)]">
                <div className="text-[.72rem] text-[var(--text-2)] font-medium mb-3">ประวัติการติดตาม</div>
                {detail.timeline.length === 0 ? (
                  <p className="text-[.82rem] text-[var(--text-3)]">ยังไม่มีบันทึก</p>
                ) : (
                  <div className="relative pl-4 before:content-[''] before:absolute before:left-[3px] before:top-1 before:bottom-1 before:w-[1.5px] before:bg-[var(--border-2)]">
                    {detail.timeline.map((t) => (
                      <div key={t.activityId} className="relative pb-3.5 last:pb-0 before:content-[''] before:absolute before:-left-4 before:top-1 before:h-2 before:w-2 before:rounded-full before:bg-[var(--primary)] before:border-2 before:border-white">
                        <div className="text-[.72rem] text-[var(--text-3)]">
                          {fmtDateTime(t.at)}
                        </div>
                        <div className="text-[.82rem] mt-0.5">{t.summary ?? t.type}{t.detail ? <span className="text-[var(--text-2)]"> — {t.detail.slice(0, 120)}</span> : null}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* น้องไอรา — 3-line handover brief */}
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[.72rem] text-[var(--text-2)] font-medium">💁‍♀️ น้องไอราสรุปให้</div>
                  <button onClick={askAira} disabled={aira.loading}
                    className="text-[.7rem] px-2.5 py-1 rounded-full border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] disabled:opacity-50">
                    {aira.loading ? "กำลังอ่าน timeline…" : aira.lines ? "สรุปใหม่" : "ให้ไอราสรุป"}
                  </button>
                </div>
                {aira.error && <p className="text-[.76rem] text-[var(--red)]">{aira.error}</p>}
                {aira.lines && (
                  <div className="bg-[var(--green-soft)] rounded-xl p-3 space-y-1">
                    {aira.lines.map((l, i) => <p key={i} className="text-[.82rem] leading-relaxed">{["📍", "⛔", "👉"][i] ?? "•"} {l}</p>)}
                  </div>
                )}
              </div>

              {detail.draft && (
                <div className="px-5 py-4 border-b border-[var(--border)]">
                  <div className="text-[.72rem] text-[var(--text-2)] font-medium mb-2">✎ น้องไอราร่างข้อความให้ส่ง</div>
                  <div className="bg-[var(--accent-soft)] rounded-xl p-3.5">
                    <p className="text-[.84rem] leading-relaxed">{detail.draft}</p>
                    <button onClick={copyDraft}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 bg-[var(--primary)] text-white rounded-lg py-2 text-[.78rem] font-medium hover:bg-[var(--accent-text)] transition">
                      {copied ? <><Check size={13} /> คัดลอกแล้ว — เปิด LINE ส่งเองได้เลย</> : <><Copy size={13} /> คัดลอก แล้วส่งเอง</>}
                    </button>
                  </div>
                </div>
              )}

              <div className="p-5 flex gap-2 flex-wrap">
                <button onClick={() => setLogOpen(true)}
                  className="px-4 py-2 rounded-[9px] text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] transition">
                  บันทึกการติดต่อ
                </button>
                {(["hot", "warm", "cold"] as const).filter((t) => t !== detail.temperature).map((t) => (
                  <button key={t}
                    onClick={async () => {
                      await fetch(`/api/leads/${detail.leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ temperature: t }) });
                      loadDetail(detail.leadId); loadList();
                    }}
                    className="px-4 py-2 rounded-[9px] text-[.8rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] transition">
                    ตั้งเป็น {t.toUpperCase()}
                  </button>
                ))}
                <button onClick={openSwitch}
                  className="px-4 py-2 rounded-[9px] text-[.8rem] border border-[var(--amber)] text-[var(--amber)] bg-[var(--amber-soft)] hover:brightness-95 transition">
                  🔁 ย้ายยี่ห้อ
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {addOpen && (
        <AddLeadModal
          onClose={() => setAddOpen(false)}
          onCreated={(leadId) => { setAddOpen(false); setFilter("all"); setSelected(leadId); loadList(); }}
        />
      )}
      {qrOpen && <QrLeadModal onClose={() => setQrOpen(false)} />}
      {calOpen && <CalendarModal onClose={() => setCalOpen(false)} owner={me?.user?.role === "sales" ? me.user.funUserId : null} />}

      {/* ── cross-brand switch modal ── */}
      {switchOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setSwitchOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base">🔁 ย้ายยี่ห้อ — {detail.customerName}</h3>
              <button onClick={() => setSwitchOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={18} /></button>
            </div>
            <p className="text-[.74rem] text-[var(--text-2)] bg-[var(--amber-soft)] rounded-lg p-2.5">
              Lead {detail.brand} เดิมจะปิดเป็น &ldquo;ย้ายยี่ห้อ&rdquo; (ไม่นับเป็นเสียลูกค้า) และเปิด Lead ใหม่ในยี่ห้อปลายทาง <b>เซลส์คนเดิมดูแลต่อ</b> — ผจก. ทั้งสองฝั่งได้รับแจ้งอัตโนมัติ
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ยี่ห้อปลายทาง *</span>
                <select value={sw.brandId} onChange={(e) => setSw({ ...sw, brandId: e.target.value, branchId: "", modelId: "" })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg">
                  <option value="">— เลือก —</option>
                  {swData.brands.filter((b) => b.brandName !== detail.brand).map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[.72rem] text-[var(--text-2)] block mb-1">สาขาปลายทาง *</span>
                <select value={sw.branchId} onChange={(e) => setSw({ ...sw, branchId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg" disabled={!sw.brandId}>
                  <option value="">— เลือก —</option>
                  {swData.branches.filter((b) => b.isActive && b.brandId === Number(sw.brandId)).map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
                </select>
              </label>
              <label className="block col-span-2">
                <span className="text-[.72rem] text-[var(--text-2)] block mb-1">รุ่นที่จะเทียบ/จบ</span>
                <select value={sw.modelId} onChange={(e) => setSw({ ...sw, modelId: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg" disabled={!sw.brandId}>
                  <option value="">— ไม่ระบุ —</option>
                  {swData.models.map((m) => <option key={m.modelId} value={m.modelId}>{m.modelName}</option>)}
                </select>
              </label>
              <label className="block col-span-2">
                <span className="text-[.72rem] text-[var(--text-2)] block mb-1">เหตุผล/โน้ต</span>
                <input value={sw.note} onChange={(e) => setSw({ ...sw, note: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg" placeholder="เช่น ลูกค้าเทียบแล้วชอบออปชั่นมากกว่า" />
              </label>
            </div>
            <button
              onClick={async () => {
                if (!sw.brandId || !sw.branchId) return;
                const res = await fetch(`/api/leads/${detail.leadId}/switch-brand`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    brandId: Number(sw.brandId), branchId: Number(sw.branchId),
                    modelId: sw.modelId ? Number(sw.modelId) : undefined,
                    note: sw.note || undefined,
                    byUserId: me?.user?.funUserId,
                  }),
                });
                const d = await res.json().catch(() => ({}));
                setSwitchOpen(false);
                if (res.ok) { setFilter("all"); setSelected(d.newLeadId); loadList(); }
                else alert(d.error ?? "ย้ายไม่สำเร็จ");
              }}
              disabled={!sw.brandId || !sw.branchId}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95 disabled:opacity-50">
              ยืนยันย้ายยี่ห้อ
            </button>
          </div>
        </div>
      )}

      {/* ── quick-log modal ── */}
      {logOpen && detail && (
        <div className="fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => setLogOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base">บันทึกการติดต่อ — {detail.customerName}</h3>
              <button onClick={() => setLogOpen(false)} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={18} /></button>
            </div>
            <label className="block">
              <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ช่องทาง</span>
              <select value={logType} onChange={(e) => setLogType(e.target.value)} className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg">
                <option value="call_out">โทรออก</option><option value="line_msg">LINE</option>
                <option value="visit_showroom">ลูกค้าเข้าโชว์รูม</option><option value="test_drive">ทดลองขับ</option>
                <option value="quote_sent">ส่งใบเสนอราคา</option><option value="note">บันทึกอื่นๆ</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ผลลัพธ์</span>
              <select value={logOutcome} onChange={(e) => setLogOutcome(e.target.value)} className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg">
                <option value="reached">คุยได้</option><option value="no_answer">ไม่รับสาย</option>
                <option value="appointment_made">นัดได้</option><option value="interested">สนใจ</option>
                <option value="considering">ขอคิดดูก่อน</option><option value="not_interested">ไม่สนใจ</option>
              </select>
            </label>
            <label className="block">
              <span className="text-[.72rem] text-[var(--text-2)] block mb-1">สรุปสั้นๆ</span>
              <input value={logSummary} onChange={(e) => setLogSummary(e.target.value)} placeholder="เช่น โทรคุยแล้ว นัดดูรถเสาร์นี้"
                className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg" />
            </label>
            <label className="block">
              <span className="text-[.72rem] text-[var(--text-2)] block mb-1">นัดติดตามครั้งถัดไป</span>
              <input type="datetime-local" value={logNext} onChange={(e) => setLogNext(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg" />
            </label>
            <button onClick={saveLog} disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50 transition">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} บันทึก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
