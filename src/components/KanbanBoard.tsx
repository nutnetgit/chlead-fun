"use client";

// Trello-style pipeline board (per the approved gold mockup). Dragging a card
// to another column PATCHes the lead's stage; clicking a card opens it in the
// list/detail view.

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fmtDayMonth } from "@/lib/date";

export type KanbanRow = {
  leadId: number; customerName: string; brand: string; modelInterest: string | null;
  temperature: string | null; temperatureConflict: boolean; aiScore: number | null;
  stage: string; daysIdle: number; nextActionAt: string | null; ownerName?: string | null;
};

const COLUMNS: { stage: string; label: string; dot: string }[] = [
  { stage: "new", label: "Lead ใหม่", dot: "var(--accent-gold)" },
  { stage: "contacted", label: "ติดต่อแล้ว", dot: "#C9C2B2" },
  { stage: "qualified", label: "คัดกรองแล้ว", dot: "#C9C2B2" },
  { stage: "appointment", label: "นัดหมาย", dot: "var(--accent-gold)" },
  { stage: "test_drive", label: "ทดลองขับ", dot: "#C9C2B2" },
  { stage: "negotiation", label: "ต่อรองราคา", dot: "#C9C2B2" },
  { stage: "finance_check", label: "เช็คไฟแนนซ์", dot: "#C9C2B2" },
  { stage: "booking", label: "จองแล้ว 🎉", dot: "var(--green)" },
];

function TempPill({ t }: { t: string | null }) {
  const cls =
    t === "hot" ? "bg-[var(--red-soft)] text-[var(--red)]" :
    t === "warm" ? "bg-[var(--amber-soft)] text-[var(--amber)]" :
    "bg-[var(--surface-2)] text-[var(--text-3)]";
  return <span className={`text-[.6rem] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{t ? t.toUpperCase() : "ยังไม่ประเมิน"}</span>;
}

export function KanbanBoard({ rows, onMove, onSelect }: {
  rows: KanbanRow[];
  onMove: (leadId: number, stage: string) => Promise<void>;
  onSelect: (leadId: number) => void;
}) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const dueLabel = (r: KanbanRow) => {
    if (!r.nextActionAt) return { text: "ไม่มีนัด", cls: "bg-[var(--surface-2)] text-[var(--text-3)]" };
    const d = new Date(r.nextActionAt); const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    if (d < today) return { text: `ค้าง ${r.daysIdle} วัน`, cls: "bg-[var(--red-soft)] text-[var(--red)] font-semibold" };
    if (d < tomorrow) return { text: "ตามวันนี้", cls: "bg-[var(--accent-soft)] text-[var(--accent-text)] font-semibold" };
    return { text: `ตาม ${fmtDayMonth(d)}`, cls: "bg-[var(--surface-2)] text-[var(--text-2)]" };
  };

  return (
    <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-4">
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: "thin" }}>
        {COLUMNS.map((col) => {
          const cards = rows.filter((r) => r.stage === col.stage);
          return (
            <div key={col.stage}
              onDragOver={(e) => { e.preventDefault(); setOverCol(col.stage); }}
              onDragLeave={() => setOverCol(null)}
              onDrop={async (e) => {
                e.preventDefault(); setOverCol(null);
                if (draggingId !== null) { await onMove(draggingId, col.stage); setDraggingId(null); }
              }}
              className={`flex-none w-[240px] rounded-xl border p-2.5 space-y-2 min-h-[130px] transition ${
                overCol === col.stage ? "border-[var(--primary)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--surface-2)]"}`}>
              <div className="flex items-center gap-2 px-1">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: col.dot }} />
                <b className="text-[.76rem]">{col.label}</b>
                <span className="ml-auto text-[.64rem] bg-white border border-[var(--border)] rounded-full px-1.5 num">{cards.length}</span>
              </div>
              {cards.map((r) => {
                const due = dueLabel(r);
                return (
                  <div key={r.leadId} draggable
                    onDragStart={() => setDraggingId(r.leadId)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onSelect(r.leadId)}
                    className={`bg-white border border-[var(--border)] rounded-xl p-2.5 cursor-grab shadow-[0_1px_2px_rgba(34,32,27,.05)] hover:shadow-[0_4px_14px_rgba(34,32,27,.1)] hover:-translate-y-px transition ${draggingId === r.leadId ? "opacity-50 rotate-2" : ""}`}>
                    <div className="flex items-center gap-1 mb-1.5">
                      <TempPill t={r.temperature} />
                      {r.temperatureConflict && <span className="inline-flex items-center gap-0.5 text-[.58rem] font-semibold text-[var(--amber)] bg-[var(--amber-soft)] rounded-full px-1.5 py-0.5"><AlertTriangle size={9} /> AI {r.aiScore}</span>}
                    </div>
                    <div className="text-[.82rem] font-semibold leading-tight">{r.customerName}</div>
                    <div className="text-[.68rem] text-[var(--text-2)] mt-0.5 truncate">{r.brand}{r.modelInterest ? ` · ${r.modelInterest}` : ""}</div>
                    <div className="flex items-center gap-1.5 mt-2">
                      <span className={`text-[.6rem] rounded-md px-1.5 py-0.5 ${due.cls}`}>{due.text}</span>
                      <div className="flex items-center gap-1.5 ml-auto min-w-0">
                        {r.aiScore !== null && !r.temperatureConflict && <span className="text-[.58rem] text-[var(--text-3)] num shrink-0">AI {r.aiScore}</span>}
                        {r.ownerName && <span className="text-[.58rem] bg-[var(--accent-soft)] text-[var(--accent-text)] rounded-md px-1.5 py-0.5 font-medium truncate max-w-[70px]" title={r.ownerName}>{r.ownerName.split(" ")[0]}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
