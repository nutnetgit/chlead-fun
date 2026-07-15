"use client";

// SLA rule settings (user req 2026-07-14 — flagged as "the next thing to
// build": fun_sla_rule's idle-day thresholds had zero admin UI, only raw DB
// rows matched by matchSlaRule() in src/lib/sla.ts). Same list+edit-form
// pattern as /settings/branches.

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Loader2, X, Trash2 } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";
import { useMe } from "@/components/Chrome";

type BrandRow = { brandId: number; brandName: string };
type BranchRow = { branchId: number; branchName: string; brandId: number | null };
type RuleRow = {
  ruleId: number;
  scopeBrandId: number | null; scopeBrandName: string | null;
  scopeBranchId: number | null; scopeBranchName: string | null;
  applyTemperature: string;
  applyChannelCategory: string | null;
  firstResponseMinutes: number | null;
  followupIntervalDays: number | null;
  idleNudgeDays: number | null;
  idleEscalateDays: number | null;
  idleForfeitDays: number | null;
  isActive: boolean;
  effectiveFrom: string | null;
};

const TEMP_TH: Record<string, string> = { any: "ทุกระดับ", hot: "HOT", warm: "WARM", cold: "COLD" };
const CHANNEL_TH: Record<string, string> = {
  walkin: "Walk-in", phone: "โทรศัพท์", online_owned: "Online เพจ/OA", online_paid: "Online Ads",
  oem: "OEM", event: "Event/บูธ", referral: "แนะนำ", service: "ลูกค้าเก่า", fleet: "Fleet", unknown: "ไม่ระบุ",
};

type Draft = {
  scopeBrandId: string; scopeBranchId: string; applyTemperature: string; applyChannelCategory: string;
  firstResponseMinutes: string; followupIntervalDays: string; idleNudgeDays: string; idleEscalateDays: string; idleForfeitDays: string;
  isActive: boolean; effectiveFrom: string;
};
const EMPTY: Draft = {
  scopeBrandId: "", scopeBranchId: "", applyTemperature: "any", applyChannelCategory: "",
  firstResponseMinutes: "", followupIntervalDays: "", idleNudgeDays: "", idleEscalateDays: "", idleForfeitDays: "",
  isActive: true, effectiveFrom: "",
};

// Specificity score mirrors matchSlaRule() in src/lib/sla.ts — most specific
// (branch-scoped) first, generic "any/any" fallback rules last, so the admin
// reads the list in the same override order the SLA engine actually applies.
const specificity = (r: RuleRow) =>
  (r.scopeBranchId !== null ? 8 : 0) + (r.scopeBrandId !== null ? 4 : 0) +
  (r.applyChannelCategory ? 2 : 0) + (r.applyTemperature !== "any" ? 1 : 0);

export default function SlaRulesPage() {
  const me = useMe();
  const isManager = me?.user?.role === "manager";
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch("/api/settings/sla-rules").then((r) => r.json()).then((d) => {
    setRules(d.rules); setBrands(d.brands); setBranches(d.branches);
  });
  useEffect(() => { load(); }, []);

  const editFormRef = useRef<HTMLDivElement>(null);
  const startEdit = (r: RuleRow) => {
    setEditingId(r.ruleId);
    setDraft({
      scopeBrandId: r.scopeBrandId !== null ? String(r.scopeBrandId) : "",
      scopeBranchId: r.scopeBranchId !== null ? String(r.scopeBranchId) : "",
      applyTemperature: r.applyTemperature,
      applyChannelCategory: r.applyChannelCategory ?? "",
      firstResponseMinutes: r.firstResponseMinutes !== null ? String(r.firstResponseMinutes) : "",
      followupIntervalDays: r.followupIntervalDays !== null ? String(r.followupIntervalDays) : "",
      idleNudgeDays: r.idleNudgeDays !== null ? String(r.idleNudgeDays) : "",
      idleEscalateDays: r.idleEscalateDays !== null ? String(r.idleEscalateDays) : "",
      idleForfeitDays: r.idleForfeitDays !== null ? String(r.idleForfeitDays) : "",
      isActive: r.isActive,
      effectiveFrom: r.effectiveFrom ? r.effectiveFrom.slice(0, 10) : "",
    });
    setError(null);
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    setSaving(true); setError(null);
    const body = {
      scopeBrandId: draft.scopeBrandId ? Number(draft.scopeBrandId) : null,
      scopeBranchId: draft.scopeBranchId ? Number(draft.scopeBranchId) : null,
      applyTemperature: draft.applyTemperature,
      applyChannelCategory: draft.applyChannelCategory || null,
      firstResponseMinutes: draft.firstResponseMinutes.trim() ? Number(draft.firstResponseMinutes) : null,
      followupIntervalDays: draft.followupIntervalDays.trim() ? Number(draft.followupIntervalDays) : null,
      idleNudgeDays: draft.idleNudgeDays.trim() ? Number(draft.idleNudgeDays) : null,
      idleEscalateDays: draft.idleEscalateDays.trim() ? Number(draft.idleEscalateDays) : null,
      idleForfeitDays: draft.idleForfeitDays.trim() ? Number(draft.idleForfeitDays) : null,
      isActive: draft.isActive,
      effectiveFrom: draft.effectiveFrom || null,
    };
    const res = await fetch(editingId === null ? "/api/settings/sla-rules" : `/api/settings/sla-rules/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { cancel(); load(); } else { setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ"); }
    setSaving(false);
  }

  async function toggleActive(r: RuleRow) {
    await fetch(`/api/settings/sla-rules/${r.ruleId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !r.isActive }),
    });
    load();
  }

  async function removeRule(r: RuleRow) {
    if (!confirm(`ลบกฎ SLA #${r.ruleId}? (ลบได้เฉพาะเมื่อยังไม่มีเหตุการณ์ SLA อ้างถึง)`)) return;
    const res = await fetch(`/api/settings/sla-rules/${r.ruleId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }

  const scopeLabel = (r: RuleRow) => {
    if (r.scopeBranchId !== null) return r.scopeBranchName ?? `สาขา #${r.scopeBranchId}`;
    if (r.scopeBrandId !== null) return r.scopeBrandName ?? `แบรนด์ #${r.scopeBrandId}`;
    return "ทุกสาขา/แบรนด์";
  };

  const sortedRules = rules ? [...rules].sort((a, b) => specificity(b) - specificity(a)) : null;
  const branchOptions = draft.scopeBrandId ? branches.filter((b) => b.brandId === Number(draft.scopeBrandId)) : branches;

  return (
    <SettingsShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-[1.5rem]">กฎ SLA</h1>
          <p className="text-[var(--text-2)] text-[.9rem]">
            เวลาที่ระบบใช้เตือนเซลส์/แจ้งผจก./ริบ Lead กลับ Pool — เมื่อ Lead ตรงกับหลายกฎ
            ระบบใช้กฎที่ &quot;เจาะจงที่สุด&quot; เสมอ: สาขา &gt; แบรนด์ &gt; ประเภทช่องทาง &gt; ระดับความสนใจเฉพาะ &gt; ทั่วไป (any/any)
            — เปิด/ปิดการทำงานของ SLA Engine ทั้งระบบได้ที่ /settings/automation, หน้านี้ตั้งเฉพาะตัวเลขวัน/นาที
          </p>
        </div>

        <Card title="กฎที่ตั้งไว้ทั้งหมด" desc="เรียงจากเจาะจงที่สุดไปทั่วไปที่สุด — แถวบนชนะแถวล่างเมื่อ Lead ตรงกับหลายกฎ">
          {sortedRules === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> :
            sortedRules.length === 0 ? <p className="text-sm text-[var(--text-2)]">ยังไม่มีกฎ SLA</p> : (
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
              {sortedRules.map((r) => (
                <div key={r.ruleId} className={`flex items-center gap-3 px-4 py-2.5 bg-white flex-wrap ${!r.isActive ? "opacity-50" : ""}`}>
                  <div className="flex-1 min-w-[14rem]">
                    <div className="flex items-center gap-1.5 flex-wrap text-[.8rem]">
                      <span className="font-medium">{scopeLabel(r)}</span>
                      <span className="text-[var(--text-3)]">·</span>
                      <span className="bg-[var(--bg)] rounded-full px-2 py-0.5 text-[.7rem]">{TEMP_TH[r.applyTemperature] ?? r.applyTemperature}</span>
                      {r.applyChannelCategory && <span className="bg-[var(--bg)] rounded-full px-2 py-0.5 text-[.7rem]">{CHANNEL_TH[r.applyChannelCategory] ?? r.applyChannelCategory}</span>}
                    </div>
                    <div className="text-[.72rem] text-[var(--text-2)] mt-1 num">
                      {r.firstResponseMinutes !== null && <span className="mr-2">ตอบครั้งแรกใน {r.firstResponseMinutes} นาที</span>}
                      {r.idleNudgeDays !== null && <span className="mr-2">เตือนเซลส์ {r.idleNudgeDays}วัน</span>}
                      {r.idleEscalateDays !== null && <span className="mr-2">แจ้งผจก. {r.idleEscalateDays}วัน</span>}
                      {r.idleForfeitDays !== null ? <span className="mr-2">ริบ pool {r.idleForfeitDays}วัน</span> : <span className="mr-2 text-[var(--text-3)]">ไม่ริบ (nurture)</span>}
                    </div>
                  </div>
                  <Toggle on={r.isActive} onClick={() => toggleActive(r)} />
                  <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไข"><Pencil size={14} /></button>
                  <button onClick={() => removeRule(r)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ (เมื่อยังไม่มีเหตุการณ์ SLA อ้างถึง)"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div ref={editFormRef} className="scroll-mt-4" />
        <Card title={editingId === null ? "เพิ่มกฎ SLA" : `แก้ไขกฎ #${editingId}`}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">
                แบรนด์{isManager ? " *" : " (ว่าง = ทุกแบรนด์)"}
              </span>
              <select value={draft.scopeBrandId} onChange={(e) => setDraft({ ...draft, scopeBrandId: e.target.value, scopeBranchId: "" })} className={inputCls}>
                {/* Managers must pick a brand they manage — no global-rule
                    option (user req 2026-07-15: a manager's SLA rules are
                    scoped to their own brands, same as /settings/models). */}
                {!isManager && <option value="">— ทุกแบรนด์ —</option>}
                {brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สาขา (ว่าง = ทุกสาขา — เจาะจงกว่าแบรนด์)</span>
              <select value={draft.scopeBranchId} onChange={(e) => setDraft({ ...draft, scopeBranchId: e.target.value })} className={inputCls}>
                <option value="">— ทุกสาขา —</option>
                {branchOptions.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ระดับความสนใจ</span>
              <select value={draft.applyTemperature} onChange={(e) => setDraft({ ...draft, applyTemperature: e.target.value })} className={inputCls}>
                {Object.entries(TEMP_TH).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ประเภทช่องทาง (ว่าง = ทุกช่องทาง)</span>
              <select value={draft.applyChannelCategory} onChange={(e) => setDraft({ ...draft, applyChannelCategory: e.target.value })} className={inputCls}>
                <option value="">— ทุกช่องทาง —</option>
                {Object.entries(CHANNEL_TH).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">มีผลตั้งแต่ (ว่างได้)</span>
              <input type="date" value={draft.effectiveFrom} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={inputCls} />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ตอบครั้งแรกภายใน (นาที)</span>
              <input inputMode="numeric" value={draft.firstResponseMinutes} onChange={(e) => setDraft({ ...draft, firstResponseMinutes: e.target.value })} className={inputCls} placeholder="ไม่กำหนด" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ติดตามซ้ำทุก (วัน)</span>
              <input inputMode="numeric" value={draft.followupIntervalDays} onChange={(e) => setDraft({ ...draft, followupIntervalDays: e.target.value })} className={inputCls} placeholder="ไม่กำหนด" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">เตือนเซลส์เมื่อเงียบ (วัน)</span>
              <input inputMode="numeric" value={draft.idleNudgeDays} onChange={(e) => setDraft({ ...draft, idleNudgeDays: e.target.value })} className={inputCls} placeholder="ไม่กำหนด" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">แจ้ง ผจก. เมื่อเงียบ (วัน)</span>
              <input inputMode="numeric" value={draft.idleEscalateDays} onChange={(e) => setDraft({ ...draft, idleEscalateDays: e.target.value })} className={inputCls} placeholder="ไม่กำหนด" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ริบเข้า Pool เมื่อเงียบ (วัน)</span>
              <input inputMode="numeric" value={draft.idleForfeitDays} onChange={(e) => setDraft({ ...draft, idleForfeitDays: e.target.value })} className={inputCls} placeholder="ไม่ริบ (nurture)" />
            </label>
            <label className="flex items-center gap-2 mt-5">
              <Toggle on={draft.isActive} onClick={() => setDraft({ ...draft, isActive: !draft.isActive })} />
              <span className="text-[.8rem] text-[var(--text-2)]">{draft.isActive ? "เปิดใช้งานกฎนี้" : "ปิดอยู่"}</span>
            </label>
          </div>
          <p className="text-[11px] text-[var(--text-3)]">เว้นว่างช่องไหนไว้ = ไม่ตรวจสอบเงื่อนไขนั้น (เช่น เว้นว่าง &quot;ริบเข้า Pool&quot; = Lead จะไม่ถูกริบ จะย้ายเป็นสถานะ nurture แทนเมื่อเงียบนานเกินไป)</p>
          {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {editingId === null ? "เพิ่มกฎ" : "บันทึกการแก้ไข"}
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
