"use client";

// Manual add-lead form (parity with the old Prospect's add screen):
// brand → branch + model → color come from masters; salesperson from fun_user.

import { useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";

type BrandRow = { brandId: number; brandName: string };
type BranchRow = { branchId: number; branchName: string; brandId: number | null; isActive: boolean };
type ModelRow = { modelId: number; modelName: string; colors: { colorId: number; colorName: string }[] };
type UserRow = { userId: number; displayName: string; role: string; branchId: number | null; branchIds: number[] };
type SourceRow = { channelId: number; channelName: string; category: string; isActive: boolean };

const inputCls = "w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";

// Grouped like /settings/sources itself (user req 2026-07-13: this dropdown
// used to be 5 hardcoded options unrelated to the real channel list an admin
// manages there — now it reads the same fun_source_channel rows, grouped
// under Showroom/Online/Event so the list stays short instead of dumping
// every category flat).
const SHOWROOM_CATEGORIES = ["walkin", "phone", "referral", "service", "fleet"];
const ONLINE_CATEGORIES = ["online_owned", "online_paid", "oem", "unknown"];
const EVENT_CATEGORIES = ["event"];

export function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (leadId: number, reopen: boolean) => void }) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);

  const [f, setF] = useState({
    customerName: "", phone: "", brandId: "", branchId: "", channelId: "",
    modelId: "", colorName: "", ownerUserId: "", budgetNote: "", note: "", consent: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [me, setMe] = useState<{ role: string; funUserId: number } | null>(null);

  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((d) => { setBrands(d.brands); setBranches(d.branches); });
    fetch("/api/users").then((r) => r.json()).then(setUsers);
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.user) setMe({ role: d.user.role, funUserId: d.user.funUserId }); });
    fetch("/api/sources").then((r) => r.json()).then((rows: SourceRow[]) => {
      setSources(rows);
      const firstActive = rows.find((s) => s.isActive && SHOWROOM_CATEGORIES.includes(s.category));
      if (firstActive) setF((prev) => ({ ...prev, channelId: String(firstActive.channelId) }));
    });
  }, []);

  // Per-branch separation for sales (2026-07-13 permission audit — this
  // modal showed every brand/branch to everyone): a sales user only files
  // leads under their own branches/brands, mirroring QrLeadModal's scoping.
  // No branch links at all → graceful fallback to everything, same as the QR
  // modal. Manager+ keep the full list.
  const isSales = me?.role === "sales";
  const myBranchIdSet = useMemo(() => {
    if (!isSales) return null;
    const self = users.find((u) => u.userId === me?.funUserId);
    const ids = new Set([...(self?.branchIds ?? []), ...(self?.branchId ? [self.branchId] : [])]);
    return ids.size ? ids : null;
  }, [isSales, users, me]);
  const visibleBranches = useMemo(
    () => branches.filter((b) => b.isActive && (!myBranchIdSet || myBranchIdSet.has(b.branchId))),
    [branches, myBranchIdSet],
  );
  const visibleBrands = useMemo(() => {
    if (!myBranchIdSet) return brands;
    const brandIds = new Set(visibleBranches.map((b) => b.brandId).filter((x): x is number => x !== null));
    return brands.filter((b) => brandIds.has(b.brandId));
  }, [brands, visibleBranches, myBranchIdSet]);

  const showroomSources = sources.filter((s) => s.isActive && SHOWROOM_CATEGORIES.includes(s.category));
  const onlineSources = sources.filter((s) => s.isActive && ONLINE_CATEGORIES.includes(s.category));
  const eventSources = sources.filter((s) => s.isActive && EVENT_CATEGORIES.includes(s.category));
  useEffect(() => {
    if (!f.brandId) { setModels([]); return; }
    fetch(`/api/models?brandId=${f.brandId}`).then((r) => r.json()).then(setModels);
  }, [f.brandId]);

  const brandBranches = useMemo(
    () => visibleBranches.filter((b) => !f.brandId || b.brandId === Number(f.brandId) || b.brandId === null),
    [visibleBranches, f.brandId],
  );
  const selectedModel = models.find((m) => m.modelId === Number(f.modelId));

  async function save() {
    if (!f.customerName.trim() || !f.brandId || !f.branchId || !f.channelId) { setError("กรอกชื่อ เลือกแบรนด์ สาขา และช่องทางก่อน"); return; }
    setSaving(true); setError(null);
    const res = await fetch("/api/leads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: f.customerName, phone: f.phone || undefined,
        brandId: Number(f.brandId), branchId: Number(f.branchId), channelId: Number(f.channelId),
        modelId: f.modelId ? Number(f.modelId) : undefined,
        colorName: f.colorName || undefined,
        ownerUserId: f.ownerUserId ? Number(f.ownerUserId) : undefined,
        budgetNote: f.budgetNote || undefined, note: f.note || undefined, consent: f.consent,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) onCreated(d.leadId, !!d.reopen);
    else setError(d.error ?? "บันทึกไม่สำเร็จ");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">เพิ่ม Lead ใหม่</h3>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 md:col-span-1">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ชื่อลูกค้า *</span>
            <input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} className={inputCls} placeholder="ชื่อ-สกุล หรือชื่อเล่น" />
          </label>
          <label className="block col-span-2 md:col-span-1">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">เบอร์โทร</span>
            <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inputCls} placeholder="08xxxxxxxx (ใช้จับลูกค้าซ้ำ)" />
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">แบรนด์ *</span>
            <select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, branchId: "", modelId: "", colorName: "" })} className={inputCls}>
              <option value="">— เลือก —</option>
              {visibleBrands.map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">สาขา *</span>
            <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} className={inputCls}>
              <option value="">— เลือก —</option>
              {brandBranches.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">รุ่นที่สนใจ</span>
            <select value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value, colorName: "" })} className={inputCls} disabled={!f.brandId}>
              <option value="">— ไม่ระบุ —</option>
              {models.map((m) => <option key={m.modelId} value={m.modelId}>{m.modelName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">สี</span>
            <select value={f.colorName} onChange={(e) => setF({ ...f, colorName: e.target.value })} className={inputCls} disabled={!selectedModel}>
              <option value="">— ไม่ระบุ —</option>
              {selectedModel?.colors.map((c) => <option key={c.colorId} value={c.colorName}>{c.colorName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ช่องทาง *</span>
            <select value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} className={inputCls}>
              <option value="">— เลือก —</option>
              {showroomSources.length > 0 && (
                <optgroup label="Showroom">
                  {showroomSources.map((s) => <option key={s.channelId} value={s.channelId}>{s.channelName}</option>)}
                </optgroup>
              )}
              {onlineSources.length > 0 && (
                <optgroup label="Online">
                  {onlineSources.map((s) => <option key={s.channelId} value={s.channelId}>{s.channelName}</option>)}
                </optgroup>
              )}
              {eventSources.length > 0 && (
                <optgroup label="Event">
                  {eventSources.map((s) => <option key={s.channelId} value={s.channelId}>{s.channelName}</option>)}
                </optgroup>
              )}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">เซลส์ผู้ดูแล</span>
            {isSales ? (
              // Sales always own what they create (server enforces the same) —
              // no picking colleagues.
              <input disabled value={users.find((u) => u.userId === me?.funUserId)?.displayName ?? "ตัวเอง"} className={inputCls + " opacity-70"} />
            ) : (
              <select value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })} className={inputCls}>
                <option value="">— ยังไม่มอบหมาย —</option>
                {users.filter((u) => u.role === "sales" || u.role === "manager").map((u) => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
              </select>
            )}
          </label>
          <label className="block col-span-2 md:col-span-1">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">งบประมาณ (ข้อความ)</span>
            <input value={f.budgetNote} onChange={(e) => setF({ ...f, budgetNote: e.target.value })} className={inputCls} placeholder="เช่น ~1.1 ล้าน" />
          </label>
          <label className="block col-span-2">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">โน้ต</span>
            <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={inputCls} placeholder="รายละเอียดเพิ่มเติม" />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[.8rem] text-[var(--text-2)]">
          <input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} className="accent-[var(--primary)]" />
          ลูกค้ายินยอมให้ติดต่อ (PDPA) — จำเป็นก่อนระบบส่งข้อความอัตโนมัติ
        </label>

        {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
        <button onClick={save} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : null} บันทึก Lead
        </button>
      </div>
    </div>
  );
}
