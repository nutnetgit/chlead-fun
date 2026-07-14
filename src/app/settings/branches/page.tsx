"use client";

// Branch management, grouped by brand (สาขาแยกยี่ห้อ). branch_code links
// fun_channel_config routing → keep codes short/stable (e.g. NPT, SLY).

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Loader2, X, Trash2 } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type BrandRow = { brandId: number; brandName: string };
type BranchRow = {
  branchId: number; branchName: string; branchCode: string | null; brandId: number | null; brandName: string | null; isActive: boolean;
  companyNameFull: string | null; companyAddress: string | null;
};

type Draft = { branchName: string; branchCode: string; brandId: string; companyNameFull: string; companyAddress: string };
const EMPTY: Draft = { branchName: "", branchCode: "", brandId: "", companyNameFull: "", companyAddress: "" };

export default function BranchesPage() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch("/api/branches?all=1").then((r) => r.json()).then((d) => { setBrands(d.brands); setBranches(d.branches); });
  useEffect(() => { load(); }, []);

  // Edit form sits at the bottom of a long branch list — scroll it into view
  // on แก้ไข (same fix as /settings/users and /settings/teams).
  const editFormRef = useRef<HTMLDivElement>(null);
  const startEdit = (b: BranchRow) => {
    setEditingId(b.branchId);
    setDraft({
      branchName: b.branchName, branchCode: b.branchCode ?? "", brandId: b.brandId ? String(b.brandId) : "",
      companyNameFull: b.companyNameFull ?? "", companyAddress: b.companyAddress ?? "",
    });
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    if (!draft.branchName.trim()) { setError("ต้องระบุชื่อสาขา"); return; }
    setSaving(true); setError(null);
    const body = {
      branchName: draft.branchName, branchCode: draft.branchCode, brandId: draft.brandId ? Number(draft.brandId) : null,
      companyNameFull: draft.companyNameFull, companyAddress: draft.companyAddress,
    };
    const res = await fetch(editingId === null ? "/api/branches" : `/api/branches/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { cancel(); load(); } else { setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ"); }
    setSaving(false);
  }

  async function toggleActive(b: BranchRow) {
    await fetch(`/api/branches/${b.branchId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !b.isActive }),
    });
    load();
  }

  // Delete policy: unused → deleted; in use → API blocks with the reason.
  async function removeBranch(b: BranchRow) {
    if (!confirm(`ลบสาขา "${b.branchName}"? (ลบได้เฉพาะเมื่อยังไม่มีการใช้งาน)`)) return;
    const res = await fetch(`/api/branches/${b.branchId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }

  const [newBrand, setNewBrand] = useState("");
  async function addBrand() {
    if (!newBrand.trim()) return;
    const res = await fetch("/api/brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandName: newBrand }) });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "เพิ่มไม่สำเร็จ");
    setNewBrand(""); load();
  }
  async function removeBrand(b: BrandRow) {
    if (!confirm(`ลบแบรนด์ "${b.brandName}"? (ลบได้เฉพาะเมื่อไม่มีสาขา/Lead/รุ่นรถอ้างถึง)`)) return;
    const res = await fetch(`/api/brands/${b.brandId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }
  async function renameBrand(b: BrandRow) {
    const name = prompt("ชื่อแบรนด์ใหม่:", b.brandName);
    if (!name?.trim() || name === b.brandName) return;
    const res = await fetch(`/api/brands/${b.brandId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandName: name }) });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "แก้ไขไม่สำเร็จ");
    load();
  }

  // group branches: by brand, unbranded last
  const groups: { label: string; rows: BranchRow[] }[] = [
    ...brands.map((br) => ({ label: br.brandName, rows: (branches ?? []).filter((b) => b.brandId === br.brandId) })),
    { label: "ไม่ระบุแบรนด์", rows: (branches ?? []).filter((b) => !b.brandId) },
  ].filter((g) => g.rows.length);

  return (
    <SettingsShell>
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">สาขาและแบรนด์</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">สาขาแยกตามยี่ห้อ · รหัสสาขา (เช่น NPT) ใช้ผูกกับ routing ช่องทาง FB → LINE</p>
      </div>

      <Card title="แบรนด์ (เพิ่มยี่ห้อใหม่ที่นี่ แล้วไป assign ให้โชว์รูมด้านล่าง)">
        <div className="flex flex-wrap gap-2">
          {brands.map((b) => (
            <span key={b.brandId} className="inline-flex items-center gap-1.5 text-[.8rem] bg-[var(--bg)] border border-[var(--border)] rounded-full pl-3 pr-1.5 py-1">
              {b.brandName}
              <button onClick={() => renameBrand(b)} className="p-0.5 rounded hover:bg-white" title="แก้ชื่อ"><Pencil size={11} /></button>
              <button onClick={() => removeBrand(b)} className="p-0.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ (เมื่อไม่มีการใช้งาน)"><Trash2 size={11} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addBrand(); }}
            placeholder="ชื่อยี่ห้อใหม่ เช่น Mazda" className={inputCls + " max-w-xs"} />
          <button onClick={addBrand} disabled={!newBrand.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            <Plus size={14} /> เพิ่มแบรนด์
          </button>
        </div>
      </Card>

      <Card title="สาขาทั้งหมด">
        {branches === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : groups.map((g) => (
          <div key={g.label} className="mb-4 last:mb-0">
            <div className="text-[.7rem] font-semibold text-[var(--text-3)] uppercase tracking-wide mb-1.5">{g.label}</div>
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
              {g.rows.map((b) => (
                <div key={b.branchId} className={`flex items-center gap-3 px-4 py-2.5 bg-white ${!b.isActive ? "opacity-50" : ""}`}>
                  <div className="flex-1">
                    <span className="text-sm font-medium">{b.branchName}</span>
                    {b.branchCode && <span className="ml-2 text-[.68rem] font-mono bg-[var(--bg)] px-1.5 py-0.5 rounded">{b.branchCode}</span>}
                  </div>
                  <Toggle on={b.isActive} onClick={() => toggleActive(b)} />
                  <button onClick={() => startEdit(b)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไข"><Pencil size={14} /></button>
                  <button onClick={() => removeBranch(b)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ (เมื่อยังไม่มีการใช้งาน)"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <div ref={editFormRef} className="scroll-mt-4" />
      <Card title={editingId === null ? "เพิ่มสาขา" : `แก้ไขสาขา #${editingId}`}>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อสาขา *</span>
            <input value={draft.branchName} onChange={(e) => setDraft({ ...draft, branchName: e.target.value })} className={inputCls} placeholder="เช่น Mazda นครปฐม" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รหัสสาขา</span>
            <input value={draft.branchCode} onChange={(e) => setDraft({ ...draft, branchCode: e.target.value })} className={inputCls + " font-mono"} placeholder="เช่น NPT" maxLength={10} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">แบรนด์</span>
            <select value={draft.brandId} onChange={(e) => setDraft({ ...draft, brandId: e.target.value })} className={inputCls}>
              <option value="">— ไม่ระบุ —</option>
              {brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อเต็มบริษัท (นิติบุคคล)</span>
            <input value={draft.companyNameFull} onChange={(e) => setDraft({ ...draft, companyNameFull: e.target.value })} className={inputCls} placeholder="เช่น บริษัท ... จำกัด" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ที่อยู่บริษัท</span>
            <input value={draft.companyAddress} onChange={(e) => setDraft({ ...draft, companyAddress: e.target.value })} className={inputCls} placeholder="ที่อยู่เต็มสำหรับออกเอกสาร" />
          </label>
        </div>
        <p className="text-[11px] text-[var(--text-3)]">ชื่อเต็มบริษัท/ที่อยู่ — เก็บไว้เผื่อดึงไปใช้ในเอกสาร (ใบเสนอราคา ฯลฯ) ยังไม่มีจุดใดดึงไปใช้อัตโนมัติ</p>
        {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingId === null ? "เพิ่มสาขา" : "บันทึกการแก้ไข"}
          </button>
          {editingId !== null && (
            <button onClick={cancel} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">
              <X size={14} /> ยกเลิก
            </button>
          )}
        </div>
      </Card>
    </div>
    </SettingsShell>
  );
}
