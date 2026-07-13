"use client";

// Lead source management — split into "Showroom" (walk-in/phone/referral/
// service/fleet) and "Online" (digital channels), matching the legacy SPS
// Prospect module's two source-management screens (user req 2026-07-08:
// "มี setting ของแหล่งที่ ให้เข้าดูระบบ prospect เก่า แบ่งย่อย ตามรูปที่แนบ").
// ผู้ดูแล + งบรวม added the same day to match the legacy screens' extra columns.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type SourceRow = {
  channelId: number; channelName: string; category: string; isActive: boolean;
  responsiblePerson: string | null; budget: number | null;
};

const SHOWROOM_CATEGORIES = ["walkin", "phone", "referral", "service", "fleet"];
const ONLINE_CATEGORIES = ["online_owned", "online_paid", "oem", "unknown"];

function SourceGroup({
  title, categories, defaultCategory, rows, onAdd, onToggle, onDelete, onUpdate,
}: {
  title: string; categories: string[]; defaultCategory: string; rows: SourceRow[];
  onAdd: (name: string, category: string, responsiblePerson: string, budget: string) => Promise<void>;
  onToggle: (r: SourceRow) => void;
  onDelete: (r: SourceRow) => void;
  onUpdate: (r: SourceRow, field: "responsiblePerson" | "budget", value: string) => void;
}) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPerson, setNewPerson] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const filtered = rows.filter((r) => categories.includes(r.category) && (!q || r.channelName.includes(q)));

  async function submit() {
    if (!newName.trim()) return;
    setSaving(true); setError("");
    await onAdd(newName.trim(), defaultCategory, newPerson.trim(), newBudget);
    setSaving(false);
    setNewName(""); setNewPerson(""); setNewBudget(""); setAdding(false);
  }

  return (
    <Card title={title}>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา…" className={inputCls + " max-w-xs"} />
        <button onClick={() => setAdding((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)]">
          <Plus size={14} /> เพิ่มช่องทางการติดต่อ
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 bg-[var(--bg)] rounded-xl p-3 flex-wrap">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อช่องทาง" className={inputCls + " flex-1 min-w-[10rem]"} autoFocus />
          <input value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="ผู้ดูแล" className={inputCls + " w-36"} />
          <input value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="งบรวม" inputMode="decimal" className={inputCls + " w-28"} />
          <button onClick={submit} disabled={saving}
            className="px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : "บันทึก"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-[var(--red)]">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
              <th className="py-2 pr-3 w-12">ลำดับ</th>
              <th className="py-2 pr-3">ช่องทางการติดต่อ</th>
              <th className="py-2 pr-3">ผู้ดูแล</th>
              <th className="py-2 pr-3">งบรวม</th>
              <th className="py-2 pr-3">สถานะ</th>
              <th className="py-2 pr-3 w-10">ลบ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} className="py-4 text-center text-[var(--text-3)] text-[.8rem]">ไม่มีรายการ</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.channelId} className="border-b border-[var(--border)] last:border-0">
                <td className="py-2 pr-3 text-[var(--text-3)]">{i + 1}</td>
                <td className={`py-2 pr-3 ${r.isActive ? "" : "text-[var(--red)]"}`}>{r.channelName}</td>
                <td className="py-2 pr-3">
                  <input defaultValue={r.responsiblePerson ?? ""} onBlur={(e) => onUpdate(r, "responsiblePerson", e.target.value)}
                    className={inputCls + " py-1.5 text-[.8rem] w-32"} placeholder="—" />
                </td>
                <td className="py-2 pr-3">
                  <input defaultValue={r.budget ?? ""} onBlur={(e) => onUpdate(r, "budget", e.target.value)}
                    inputMode="decimal" className={inputCls + " py-1.5 text-[.8rem] w-24"} placeholder="—" />
                </td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <Toggle on={r.isActive} onClick={() => onToggle(r)} />
                    <span className={`text-[.7rem] ${r.isActive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{r.isActive ? "active" : "inactive"}</span>
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <button onClick={() => onDelete(r)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function SourcesPage() {
  const [rows, setRows] = useState<SourceRow[] | null>(null);

  const load = () => { fetch("/api/sources").then((r) => r.json()).then(setRows); };
  useEffect(load, []);

  async function addSource(name: string, category: string, responsiblePerson: string, budget: string) {
    const res = await fetch("/api/sources", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channelName: name, category,
        responsiblePerson: responsiblePerson || undefined,
        budget: budget.trim() ? Number(budget) : undefined,
      }),
    });
    if (res.ok) load();
  }

  async function toggle(r: SourceRow) {
    await fetch(`/api/sources/${r.channelId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !r.isActive }),
    });
    load();
  }

  async function update(r: SourceRow, field: "responsiblePerson" | "budget", value: string) {
    const current = field === "responsiblePerson" ? (r.responsiblePerson ?? "") : String(r.budget ?? "");
    if (value === current) return;
    const body = field === "responsiblePerson"
      ? { responsiblePerson: value.trim() || null }
      : { budget: value.trim() ? Number(value) : null };
    await fetch(`/api/sources/${r.channelId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    load();
  }

  async function remove(r: SourceRow) {
    if (!confirm(`ลบ "${r.channelName}"?`)) return;
    const res = await fetch(`/api/sources/${r.channelId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }

  const list = useMemo(() => rows ?? [], [rows]);

  return (
    <SettingsShell>
      <div>
        <h1 className="text-[1.5rem]">แหล่งที่มาลูกค้า</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">แบ่งเป็น Showroom (ติดต่อโดยตรง/แนะนำ) กับ Online (ช่องทางดิจิทัล) — เพิ่ม/ปิดใช้งาน/ลบได้ที่นี่ (ลบได้เฉพาะที่ยังไม่มี Lead อ้างอิงอยู่)</p>
      </div>
      {rows === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
        <>
          <SourceGroup title="Showroom" categories={SHOWROOM_CATEGORIES} defaultCategory="walkin" rows={list} onAdd={addSource} onToggle={toggle} onDelete={remove} onUpdate={update} />
          <SourceGroup title="Online" categories={ONLINE_CATEGORIES} defaultCategory="online_owned" rows={list} onAdd={addSource} onToggle={toggle} onDelete={remove} onUpdate={update} />
        </>
      )}
    </SettingsShell>
  );
}
