"use client";

// System log (admin / owner / gm) — merged read-only timeline of everything
// the system recorded: stage moves, activities, SLA events, reassignments,
// Aira drafts.

import { useEffect, useState } from "react";
import { fmtDateTime } from "@/lib/date";
import { SettingsShell } from "@/components/SettingsShell";

type Item = { at: string; kind: string; text: string; by: string | null };

const KIND: Record<string, { label: string; cls: string }> = {
  stage: { label: "สถานะ", cls: "bg-[var(--accent-soft)] text-[var(--accent-text)]" },
  activity: { label: "กิจกรรม", cls: "bg-[var(--surface-2)] text-[var(--text-2)]" },
  sla: { label: "SLA", cls: "bg-[var(--red-soft)] text-[var(--red)]" },
  assign: { label: "เปลี่ยนมือ", cls: "bg-[var(--amber-soft)] text-[var(--amber)]" },
  aira: { label: "ไอรา", cls: "bg-[var(--green-soft)] text-[var(--green)]" },
};

export default function LogsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState("");
  useEffect(() => { fetch("/api/logs").then((r) => r.json()).then(setItems); }, []);
  const filtered = (items ?? []).filter((i) => !kind || i.kind === kind);

  return (
    <SettingsShell>
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">Log ระบบ</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">บันทึกทุกความเคลื่อนไหว (append-only ตรวจย้อนได้) — 120 รายการล่าสุด</p>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setKind("")} className={`text-[.74rem] px-3 py-1 rounded-full border ${!kind ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-medium" : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>ทั้งหมด</button>
        {Object.entries(KIND).map(([k, v]) => (
          <button key={k} onClick={() => setKind(kind === k ? "" : k)}
            className={`text-[.74rem] px-3 py-1 rounded-full border ${kind === k ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-medium" : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>{v.label}</button>
        ))}
      </div>
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
        {items === null ? <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p> :
          filtered.length === 0 ? <p className="p-5 text-sm text-[var(--text-2)]">ไม่มีรายการ</p> :
          filtered.map((i, idx) => (
            <div key={idx} className="px-5 py-2.5 border-b border-[var(--border)] last:border-0 flex items-start gap-3 text-[.82rem]">
              <span className={`text-[.62rem] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${KIND[i.kind]?.cls ?? ""}`}>{KIND[i.kind]?.label ?? i.kind}</span>
              <span className="flex-1">{i.text}{i.by && <span className="text-[var(--text-3)]"> — โดย {i.by}</span>}</span>
              <span className="text-[.68rem] text-[var(--text-3)] num shrink-0">
                {fmtDateTime(i.at)}
              </span>
            </div>
          ))}
      </div>
    </div>
    </SettingsShell>
  );
}
