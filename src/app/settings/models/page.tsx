"use client";

// Vehicle model/color master — replaces the old flow where model data lived in
// SPS only. Managed here for now; a future read-only SPS sync (once approved)
// will match rows via dms_model_id/dms_color_id instead of manual re-keying.

import { useEffect, useState } from "react";
import { Plus, Loader2, X, Pencil, Trash2 } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";
import { useMe } from "@/components/Chrome";

type BrandRow = { brandId: number; brandName: string };
type ColorRow = { colorId: number; colorName: string; isActive: boolean };
type ModelRow = { modelId: number; brandId: number; modelName: string; modelCode: string | null; isActive: boolean; colors: ColorRow[] };
type BranchRow = { branchId: number; brandId: number | null };
type UserRow = { userId: number; branchIds: number[] };

export default function ModelsPage() {
  const me = useMe();
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [models, setModels] = useState<ModelRow[] | null>(null);
  const [newModel, setNewModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [colorInputs, setColorInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    // Manager settings split (user req 2026-07-12): a manager only sees/edits
    // brands they have branch access to — derived client-side from their own
    // UserBranch links (their own name-tag on /api/users?all=1) rather than a
    // new endpoint. Admin/gm see every brand, unrestricted, as before.
    Promise.all([
      fetch("/api/branches").then((r) => r.json()) as Promise<{ brands: BrandRow[]; branches: BranchRow[] }>,
      me?.user?.role === "manager" ? (fetch("/api/users?all=1").then((r) => r.json()) as Promise<UserRow[]>) : Promise.resolve(null),
    ]).then(([d, users]) => {
      let allBrands = d.brands;
      if (me?.user?.role === "manager" && users) {
        const myBranchIds = new Set(users.find((u) => u.userId === me.user!.funUserId)?.branchIds ?? []);
        const myBrandIds = new Set(d.branches.filter((b) => myBranchIds.has(b.branchId) && b.brandId !== null).map((b) => b.brandId));
        allBrands = d.brands.filter((b) => myBrandIds.has(b.brandId));
      }
      setBrands(allBrands);
      if (allBrands.length) setBrandId(allBrands[0].brandId);
    });
  }, [me]);

  const load = (b: number) => fetch(`/api/models?brandId=${b}&all=1`).then((r) => r.json()).then(setModels);
  useEffect(() => { if (brandId) { setModels(null); load(brandId); } }, [brandId]);

  async function addModel() {
    if (!newModel.trim() || !brandId) return;
    setSaving(true);
    await fetch("/api/models", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId, modelName: newModel }),
    });
    setNewModel(""); setSaving(false); load(brandId);
  }

  async function toggleModel(m: ModelRow) {
    await fetch(`/api/models/${m.modelId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !m.isActive }) });
    if (brandId) load(brandId);
  }

  async function renameModel(m: ModelRow) {
    const name = prompt("ชื่อรุ่นใหม่:", m.modelName);
    if (!name?.trim() || name === m.modelName) return;
    await fetch(`/api/models/${m.modelId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelName: name }) });
    if (brandId) load(brandId);
  }

  // Delete policy matches branch/brand: blocked once any lead references the
  // model, with the API's own error explaining why — deactivate instead.
  async function removeModel(m: ModelRow) {
    if (!confirm(`ลบรุ่น "${m.modelName}"? (ลบได้เฉพาะเมื่อยังไม่มี Lead อ้างถึง)`)) return;
    const res = await fetch(`/api/models/${m.modelId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    if (brandId) load(brandId);
  }

  async function addColor(m: ModelRow) {
    const name = (colorInputs[m.modelId] ?? "").trim();
    if (!name) return;
    await fetch(`/api/models/${m.modelId}/colors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ colorName: name }) });
    setColorInputs((c) => ({ ...c, [m.modelId]: "" }));
    if (brandId) load(brandId);
  }

  async function toggleColor(c: ColorRow) {
    await fetch(`/api/colors/${c.colorId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !c.isActive }) });
    if (brandId) load(brandId);
  }

  return (
    <SettingsShell>
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">รุ่นรถและสี</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">Master สำหรับฟอร์มเพิ่ม Lead — เพิ่มรุ่นใหม่ที่นี่เมื่อแบรนด์เปิดตัว (อนาคตจะ sync อัตโนมัติจาก SPS เมื่อเปิดสิทธิ์อ่าน)</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {brands.map((b) => (
          <button key={b.brandId} onClick={() => setBrandId(b.brandId)}
            className={`text-[.82rem] px-3.5 py-1.5 rounded-full border transition ${
              brandId === b.brandId ? "bg-[var(--primary)] border-[var(--primary)] text-white font-medium"
                : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
            {b.brandName}
          </button>
        ))}
      </div>

      <Card title="รุ่นในแบรนด์นี้">
        {models === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> :
          models.length === 0 ? <p className="text-sm text-[var(--text-2)]">ยังไม่มีรุ่น — เพิ่มด้านล่าง</p> : (
          <div className="space-y-3">
            {models.map((m) => (
              <div key={m.modelId} className={`border border-[var(--border)] rounded-xl p-4 ${!m.isActive ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="font-medium text-sm flex-1">{m.modelName}{m.modelCode ? <span className="ml-2 text-[.68rem] font-mono bg-[var(--bg)] px-1.5 py-0.5 rounded">{m.modelCode}</span> : null}</span>
                  <span className="text-[.68rem] text-[var(--text-3)]">ใช้งาน</span>
                  <Toggle on={m.isActive} onClick={() => toggleModel(m)} />
                  <button onClick={() => renameModel(m)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไขชื่อ"><Pencil size={14} /></button>
                  <button onClick={() => removeModel(m)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ (เมื่อยังไม่มี Lead อ้างถึง)"><Trash2 size={14} /></button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {m.colors.map((c) => (
                    <button key={c.colorId} onClick={() => toggleColor(c)} title={c.isActive ? "กดเพื่อปิดใช้สีนี้" : "กดเพื่อเปิดใช้"}
                      className={`text-[.72rem] px-2.5 py-1 rounded-full border inline-flex items-center gap-1 transition ${
                        c.isActive ? "bg-[var(--accent-soft)] border-transparent text-[var(--accent-text)]"
                          : "bg-[var(--bg)] border-[var(--border-2)] text-[var(--text-3)] line-through"}`}>
                      {c.colorName}{c.isActive && <X size={10} />}
                    </button>
                  ))}
                  <input
                    value={colorInputs[m.modelId] ?? ""}
                    onChange={(e) => setColorInputs((c) => ({ ...c, [m.modelId]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") addColor(m); }}
                    placeholder="+ เพิ่มสี แล้ว Enter"
                    className="text-[.72rem] px-2.5 py-1 rounded-full border border-dashed border-[var(--border-2)] bg-white w-32 focus:outline-none focus:border-[var(--primary)]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="เพิ่มรุ่นใหม่">
        <div className="flex gap-2">
          <input value={newModel} onChange={(e) => setNewModel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addModel(); }}
            placeholder={`ชื่อรุ่น เช่น CX-60`} className={inputCls + " max-w-sm"} />
          <button onClick={addModel} disabled={saving || !newModel.trim()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} เพิ่มรุ่น
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-3)]">รุ่นใหม่จะได้สีมาตรฐานว่างเปล่า — เพิ่มสีได้ที่การ์ดรุ่นด้านบน</p>
      </Card>
    </div>
    </SettingsShell>
  );
}
