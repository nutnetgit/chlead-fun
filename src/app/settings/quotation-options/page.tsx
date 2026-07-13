"use client";

// Quotation settings (ADR-015): the option master the quote composer's
// checklist reads from (see /quotes/new), grouped by category — reusing the
// group-table pattern from /settings/sources so it stays visually
// consistent. Seeded with a starter list in sql/025 (Nutt revises it here);
// most rows carry no fixed value on purpose — actual prices vary per deal
// and get typed in per quote.
//
// The master switch at the top turns the whole quotation feature on/off —
// it gates both the "สร้างใบเสนอราคา" button in /chat and the create API,
// so the feature can stay hidden from sales until this list is ready.

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type OptionRow = { optionId: number; optionType: string; optionName: string; optionValue: number | null; isActive: boolean };

function OptionGroup({
  title, type, valueLabel, rows, onAdd, onToggle, onDelete, onEdit,
}: {
  title: string; type: string; valueLabel: string; rows: OptionRow[];
  onAdd: (name: string, type: string, value: string) => Promise<void>;
  onToggle: (r: OptionRow) => void;
  onDelete: (r: OptionRow) => void;
  onEdit: (r: OptionRow, name: string, value: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const filtered = rows.filter((r) => r.optionType === type);

  async function submit() {
    if (!newName.trim()) return;
    setSaving(true);
    await onAdd(newName.trim(), type, newValue);
    setSaving(false);
    setNewName(""); setNewValue(""); setAdding(false);
  }

  const startEdit = (r: OptionRow) => {
    setEditingId(r.optionId); setEditName(r.optionName); setEditValue(r.optionValue !== null ? String(r.optionValue) : "");
  };
  const cancelEdit = () => setEditingId(null);
  async function submitEdit(r: OptionRow) {
    if (!editName.trim()) return;
    setEditSaving(true);
    await onEdit(r, editName.trim(), editValue);
    setEditSaving(false);
    setEditingId(null);
  }

  return (
    <Card title={title}>
      <div className="flex items-center gap-2">
        <button onClick={() => setAdding((v) => !v)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)]">
          <Plus size={14} /> เพิ่มรายการ
        </button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 bg-[var(--bg)] rounded-xl p-3">
          {/* inputCls carries w-full, and .w-full sits AFTER fixed widths in
              the generated sheet — a w-32 on the same element silently loses
              (this was the "edit row blows past the screen" bug). Fixed-width
              fields therefore get a sized wrapper instead of a width class. */}
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อรายการ" maxLength={200} className={inputCls + " flex-1 min-w-0 max-w-2xl"} autoFocus />
          <div className="w-32 shrink-0"><input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={valueLabel} inputMode="decimal" maxLength={30} className={inputCls + " text-right"} /></div>
          <button onClick={submit} disabled={saving}
            className="px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : "บันทึก"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
              <th className="py-2 pr-3 w-12">ลำดับ</th>
              <th className="py-2 pr-3">ชื่อรายการ</th>
              <th className="py-2 pr-3">{valueLabel}</th>
              <th className="py-2 pr-3">สถานะ</th>
              <th className="py-2 pr-3 w-16">แก้ไข/ลบ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-4 text-center text-[var(--text-3)] text-[.8rem]">ไม่มีรายการ</td></tr>
            ) : filtered.map((r, i) => (
              <tr key={r.optionId} className="border-b border-[var(--border)] last:border-0">
                {editingId === r.optionId ? (
                  <td colSpan={5} className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-3)] w-6 shrink-0">{i + 1}</span>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={200} className={inputCls + " flex-1 min-w-0 max-w-2xl"} autoFocus />
                      <div className="w-32 shrink-0"><input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder={valueLabel} inputMode="decimal" maxLength={30} className={inputCls + " text-right"} /></div>
                      <button onClick={() => submitEdit(r)} disabled={editSaving}
                        className="p-1.5 rounded hover:bg-[var(--accent-soft)] text-[var(--accent-text)]" title="บันทึก">
                        {editSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      </button>
                      <button onClick={cancelEdit} className="p-1.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-3)]" title="ยกเลิก"><X size={14} /></button>
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="py-2 pr-3 text-[var(--text-3)]">{i + 1}</td>
                    <td className={`py-2 pr-3 ${r.isActive ? "" : "text-[var(--red)]"}`}>{r.optionName}</td>
                    <td className="py-2 pr-3 num">{r.optionValue !== null ? r.optionValue.toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <Toggle on={r.isActive} onClick={() => onToggle(r)} />
                        <span className={`text-[.7rem] ${r.isActive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{r.isActive ? "active" : "inactive"}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไข"><Pencil size={14} /></button>
                        <button onClick={() => onDelete(r)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function QuotationOptionsPage() {
  const [rows, setRows] = useState<OptionRow[] | null>(null);
  const [featureOn, setFeatureOn] = useState<boolean | null>(null);

  const load = () => { fetch("/api/quote-options").then((r) => r.json()).then(setRows); };
  useEffect(() => {
    load();
    fetch("/api/settings/features").then((r) => r.json()).then((f) => setFeatureOn(!!f.quotationEnabled)).catch(() => setFeatureOn(false));
  }, []);

  async function toggleFeature() {
    const next = !featureOn;
    setFeatureOn(next);
    const res = await fetch("/api/settings/features", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quotationEnabled: next }),
    });
    if (!res.ok) setFeatureOn(!next);
  }

  async function addOption(name: string, type: string, value: string) {
    const res = await fetch("/api/quote-options", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionName: name, optionType: type, optionValue: value.trim() ? Number(value) : undefined }),
    });
    if (res.ok) load();
  }

  async function toggle(r: OptionRow) {
    await fetch(`/api/quote-options/${r.optionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !r.isActive }),
    });
    load();
  }

  async function remove(r: OptionRow) {
    if (!confirm(`ลบ "${r.optionName}"?`)) return;
    await fetch(`/api/quote-options/${r.optionId}`, { method: "DELETE" });
    load();
  }

  async function editOption(r: OptionRow, name: string, value: string) {
    await fetch(`/api/quote-options/${r.optionId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionName: name, optionValue: value.trim() ? Number(value) : null }),
    });
    load();
  }

  const list = useMemo(() => rows ?? [], [rows]);

  return (
    <SettingsShell>
      <div>
        <h1 className="text-[1.5rem]">ตั้งค่าใบเสนอราคา</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">
          รายการอุปกรณ์/ข้อเสนอพิเศษที่เลือกได้ต่อใบเสนอราคา — ยังไม่มีราคาตายตัว กรอกมูลค่าเองต่อรายการได้ตอนออกใบเสนอราคาจริง
        </p>
      </div>

      <Card title="เปิดใช้งานฟีเจอร์ใบเสนอราคา" desc="ควบคุมปุ่ม 'สร้างใบเสนอราคา' ในหน้าแชท และการสร้างใบเสนอราคาใหม่ทั้งระบบ — ปิดไว้ระหว่างจัดรายการด้านล่างให้พร้อมก่อน">
        <div className="flex items-center gap-3">
          <Toggle on={!!featureOn} onClick={toggleFeature} disabled={featureOn === null} />
          <span className={`text-[.85rem] font-medium ${featureOn ? "text-[var(--green)]" : "text-[var(--text-3)]"}`}>
            {featureOn === null ? "กำลังโหลด…" : featureOn ? "เปิดใช้งานอยู่ — เซลส์เห็นปุ่มสร้างใบเสนอราคาในหน้าแชท" : "ปิดอยู่ — ยังไม่แสดงปุ่มให้เซลส์เห็น"}
          </span>
        </div>
      </Card>

      {rows === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
        <>
          <OptionGroup title="อุปกรณ์เสริม" type="addon" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="อุปกรณ์ตกแต่งภายนอก" type="decor_exterior" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="อุปกรณ์ตกแต่งภายใน" type="decor_interior" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="อุปกรณ์อิเล็กทรอนิกส์" type="decor_electronics" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="ชุดแต่ง / แพ็กเกจ" type="decor_other" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="ประเภททะเบียน-ประกัน / วันรับรถ" type="reg_insurance" valueLabel="ราคาเพิ่ม (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
          <OptionGroup title="ข้อเสนอพิเศษอื่นๆ" type="special_offer" valueLabel="มูลค่า (บาท)" rows={list} onAdd={addOption} onToggle={toggle} onDelete={remove} onEdit={editOption} />
        </>
      )}
    </SettingsShell>
  );
}
