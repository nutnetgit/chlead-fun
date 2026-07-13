"use client";

// Month overlay (user idea 2026-07-08): click the date chip → full-month grid
// with per-day counts of leads due to follow up (gold) and appointments (dot).

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type CalData = { month: string; daysInMonth: number; firstDow: number; due: Record<number, number>; appt: Record<number, number> };

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_DOW = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

export function CalendarModal({ onClose, owner }: { onClose: () => void; owner?: number | null }) {
  const now = new Date();
  const [ym, setYm] = useState<[number, number]>([now.getFullYear(), now.getMonth()]); // month 0-based
  const [data, setData] = useState<CalData | null>(null);

  useEffect(() => {
    const m = `${ym[0]}-${String(ym[1] + 1).padStart(2, "0")}`;
    setData(null);
    fetch(`/api/calendar?month=${m}${owner ? `&owner=${owner}` : ""}`).then((r) => r.json()).then(setData);
  }, [ym, owner]);

  const shift = (d: number) => setYm(([y, m]) => {
    const dt = new Date(y, m + d, 1);
    return [dt.getFullYear(), dt.getMonth()];
  });
  const isToday = (day: number) => ym[0] === now.getFullYear() && ym[1] === now.getMonth() && day === now.getDate();

  return (
    <div className="fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-base flex-1">ปฏิทินติดตามลูกค้า</h3>
          <button onClick={() => shift(-1)} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)]"><ChevronLeft size={16} /></button>
          <span className="text-sm font-medium min-w-[9rem] text-center">{TH_MONTHS[ym[1]]} {ym[0] + 543}</span>
          <button onClick={() => shift(1)} className="p-1.5 rounded-lg hover:bg-[var(--surface-2)]"><ChevronRight size={16} /></button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)] ml-2"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-7 gap-1.5 text-center text-[.66rem] text-[var(--text-3)] font-semibold mb-1.5">
          {TH_DOW.map((d) => <div key={d}>{d}</div>)}
        </div>
        {!data ? <p className="text-sm text-[var(--text-2)] py-10 text-center">กำลังโหลด…</p> : (
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: data.firstDow }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: data.daysInMonth }, (_, i) => i + 1).map((day) => {
              const due = data.due[day] ?? 0;
              const appt = data.appt[day] ?? 0;
              return (
                <div key={day}
                  className={`rounded-xl border p-1.5 min-h-[62px] text-left ${
                    isToday(day) ? "border-[var(--primary)] bg-[var(--accent-soft)]" :
                    due || appt ? "border-[var(--border)] bg-white" : "border-transparent bg-[var(--surface-2)]"}`}>
                  <div className={`text-[.7rem] num ${isToday(day) ? "font-bold text-[var(--accent-text)]" : "text-[var(--text-2)]"}`}>{day}</div>
                  {due > 0 && <div className="text-[.6rem] font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] rounded-md px-1 mt-0.5 num">ตาม {due}</div>}
                  {appt > 0 && <div className="text-[.6rem] bg-[var(--green-soft)] text-[var(--green)] rounded-md px-1 mt-0.5 num">นัด {appt}</div>}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[.66rem] text-[var(--text-3)] mt-3">🟡 ตาม = Lead ถึงกำหนดติดตาม · 🟢 นัด = นัดหมายที่ยืนยันแล้ว</p>
      </div>
    </div>
  );
}
