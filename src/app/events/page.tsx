"use client";

// Event settings (manager): name, dates, overall target, per-salesperson
// allocation, attending brands — with live metrics (actual leads vs target,
// fed by leads whose campaign_id points at the event via the QR intake).

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, X } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { fmtDate } from "@/lib/date";

type BrandRow = { brandId: number; brandName: string };
type UserRow = { userId: number; displayName: string; role: string; branchIds: number[] };
type BranchRow = { branchId: number; branchName: string; brandId: number | null };
type EventRow = {
  eventId: number; eventName: string; startDate: string | null; endDate: string | null;
  targetLeads: number | null; totalLeads: number; linePromoMessage: string | null;
  branchId: number | null; branchName: string | null; canEdit: boolean;
  brands: { brandId: number; brandName: string }[];
  targets: { userId: number; displayName: string; targetLeads: number; actualLeads: number }[];
};

type Draft = { eventName: string; startDate: string; endDate: string; targetLeads: string; linePromoMessage: string; branchId: string; brandIds: number[]; targets: { userId: number; targetLeads: number }[] };
const EMPTY: Draft = { eventName: "", startDate: "", endDate: "", targetLeads: "", linePromoMessage: "", branchId: "", brandIds: [], targets: [] };

const d10 = (s: string | null) => (s ? s.slice(0, 10) : "");

export default function EventsPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState<number | "all">(currentYear);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ role: string; funUserId: number } | null>(null);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);

  const load = () => fetch("/api/events").then((r) => r.json()).then(setEvents);
  useEffect(() => {
    load();
    fetch("/api/brands").then((r) => r.json()).then(setBrands);
    fetch("/api/users").then((r) => r.json()).then((us: UserRow[]) => {
      setAllUsers(us);
      setUsers(us.filter((u) => u.role === "sales" || u.role === "manager"));
    });
    fetch("/api/branches?all=1").then((r) => r.json()).then((d) => setBranches(d.branches));
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.user) setMe({ role: d.user.role, funUserId: d.user.funUserId }); });
  }, []);

  // Branch options for the owner selector: admin/gm pick any branch (or none
  // = central event); a manager only their own branches, and must pick one.
  const isManager = me?.role === "manager";
  const myBranchIds = isManager ? (allUsers.find((u) => u.userId === me?.funUserId)?.branchIds ?? []) : null;
  const branchOptions = branches.filter((b) => !isManager || (myBranchIds ?? []).includes(b.branchId));

  // Only salespeople whose branch access covers at least one of the event's
  // selected brands can sensibly get a per-sales target for it.
  const eligibleUsers = users.filter((u) =>
    draft.brandIds.length === 0 ||
    u.branchIds.some((bid) => { const brandId = branches.find((b) => b.branchId === bid)?.brandId; return brandId !== null && brandId !== undefined && draft.brandIds.includes(brandId); }));

  const startEdit = (e: EventRow) => {
    setEditingId(e.eventId);
    setDraft({
      eventName: e.eventName, startDate: d10(e.startDate), endDate: d10(e.endDate),
      targetLeads: e.targetLeads !== null ? String(e.targetLeads) : "",
      linePromoMessage: e.linePromoMessage ?? "",
      branchId: e.branchId !== null ? String(e.branchId) : "",
      brandIds: e.brands.map((b) => b.brandId),
      targets: e.targets.map((t) => ({ userId: t.userId, targetLeads: t.targetLeads })),
    });
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    if (!draft.eventName.trim() || !draft.startDate || !draft.endDate) { setError("กรอกชื่อและช่วงวันที่ก่อน"); return; }
    if (isManager && !draft.branchId) { setError("เลือกสาขาเจ้าของ event ก่อน"); return; }
    setSaving(true); setError(null);
    const eligibleIds = new Set(eligibleUsers.map((u) => u.userId));
    const body = {
      eventName: draft.eventName, startDate: draft.startDate, endDate: draft.endDate,
      targetLeads: draft.targetLeads ? Number(draft.targetLeads) : null,
      linePromoMessage: draft.linePromoMessage.trim() || null,
      branchId: draft.branchId ? Number(draft.branchId) : null,
      brandIds: draft.brandIds, targets: draft.targets.filter((t) => eligibleIds.has(t.userId)),
    };
    const res = await fetch(editingId === null ? "/api/events" : `/api/events/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { cancel(); load(); } else setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ");
    setSaving(false);
  }

  async function remove(e: EventRow) {
    if (!confirm(`ลบ event "${e.eventName}"? (ลบได้เฉพาะเมื่อยังไม่มี Lead)`)) return;
    const res = await fetch(`/api/events/${e.eventId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }

  const toggleBrand = (id: number) =>
    setDraft((d) => ({ ...d, brandIds: d.brandIds.includes(id) ? d.brandIds.filter((x) => x !== id) : [...d.brandIds, id] }));
  const setTarget = (userId: number, v: string) =>
    setDraft((d) => {
      const others = d.targets.filter((t) => t.userId !== userId);
      const n = Number(v);
      return { ...d, targets: v === "" || n <= 0 ? others : [...others, { userId, targetLeads: n }] };
    });

  const isLive = (e: EventRow) => {
    const today = new Date().toISOString().slice(0, 10);
    return d10(e.startDate) <= today && today <= d10(e.endDate);
  };

  // Events never get deleted (เก็บไว้เช็คย้อนหลัง) — just filtered by year so the
  // list doesn't grow unbounded as history piles up.
  const availableYears = [...new Set((events ?? []).map((e) => e.startDate ? new Date(e.startDate).getFullYear() : currentYear))]
    .sort((a, b) => b - a);
  if (!availableYears.includes(currentYear)) availableYears.unshift(currentYear);
  const visibleEvents = (events ?? []).filter((e) =>
    yearFilter === "all" || (e.startDate && new Date(e.startDate).getFullYear() === yearFilter) || isLive(e));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">Event / บูธ</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">ตั้ง event พร้อมเป้ารวมและเป้ารายเซลส์ — Lead ที่เข้าผ่าน QR ของ event จะนับ metric อัตโนมัติ · event ไม่ถูกลบเมื่อหมดอายุ เก็บไว้เช็คย้อนหลังได้ตลอด กรองตามปีด้านล่าง</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-[var(--text-2)]">แสดงปี</span>
        <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="text-[.8rem] px-2.5 py-1.5 bg-white border border-[var(--border-2)] rounded-lg">
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value="all">ทั้งหมดทุกปี</option>
        </select>
      </div>

      {events === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> :
        visibleEvents.length === 0 ? <p className="text-sm text-[var(--text-2)]">ไม่มี event ในปีนี้</p> :
        visibleEvents.map((e) => (
        <div key={e.eventId} className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base flex-1">{e.eventName}
              {isLive(e) && <span className="ml-2 text-[.62rem] font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] px-2 py-0.5 rounded-full">กำลังจัด</span>}
            </h3>
            <span className="text-[.76rem] text-[var(--text-2)]">{fmtDate(e.startDate)} → {fmtDate(e.endDate)}</span>
            {e.canEdit && <>
              <button onClick={() => startEdit(e)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]"><Pencil size={14} /></button>
              <button onClick={() => remove(e)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]"><Trash2 size={14} /></button>
            </>}
          </div>
          <div className="flex gap-2 flex-wrap text-[.72rem]">
            <span className={`px-2 py-0.5 rounded-full font-medium ${e.branchName ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--surface-2)] text-[var(--text-3)]"}`}>
              {e.branchName ?? "งานกลาง"}
            </span>
            {e.brands.map((b) => <span key={b.brandId} className="bg-[var(--bg)] px-2 py-0.5 rounded-full">{b.brandName}</span>)}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[.78rem] text-[var(--text-2)]">เป้ารวม</span>
            <div className="flex-1 h-4 bg-[var(--bg)] rounded-md overflow-hidden">
              <div className="h-full bg-[var(--primary)] rounded-md" style={{ width: `${e.targetLeads ? Math.min(100, (e.totalLeads / e.targetLeads) * 100) : 0}%` }} />
            </div>
            <span className="text-[.82rem] font-medium num">{e.totalLeads}{e.targetLeads ? ` / ${e.targetLeads}` : ""}</span>
          </div>
          {e.targets.length > 0 && (
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 pt-1 border-t border-[var(--border)]">
              {e.targets.map((t) => (
                <div key={t.userId} className="flex items-center gap-2 text-[.8rem]">
                  <span className="flex-1 truncate">{t.displayName}</span>
                  <span className={`num font-medium ${t.actualLeads >= t.targetLeads ? "text-[var(--green)]" : ""}`}>{t.actualLeads} / {t.targetLeads}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {events?.length === 0 && <p className="text-sm text-[var(--text-2)]">ยังไม่มี event — สร้างอันแรกด้านล่าง</p>}

      <Card title={editingId === null ? "สร้าง Event" : `แก้ไข Event #${editingId}`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อ Event *</span>
            <input value={draft.eventName} onChange={(e) => setDraft({ ...draft, eventName: e.target.value })} className={inputCls} placeholder="เช่น Motor Expo 2026 · บูธเซ็นทรัลนครปฐม" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">วันเริ่ม *</span>
            <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">วันสิ้นสุด *</span>
            <input type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">เป้า Lead รวม</span>
            <input type="number" value={draft.targetLeads} onChange={(e) => setDraft({ ...draft, targetLeads: e.target.value })} className={inputCls} placeholder="เช่น 80" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สาขาเจ้าของ event {isManager ? "*" : ""}</span>
            <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className={inputCls}>
              {!isManager && <option value="">— งานกลาง (admin/gm ดูแล) —</option>}
              {isManager && <option value="">— เลือกสาขา —</option>}
              {branchOptions.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
        </div>

        <div>
          <span className="text-[11px] font-medium text-[var(--text-2)] mb-2 block">ยี่ห้อที่ไปออก</span>
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => {
              const on = draft.brandIds.includes(b.brandId);
              return (
                <button key={b.brandId} type="button" onClick={() => toggleBrand(b.brandId)}
                  className={`text-[.76rem] px-3 py-1.5 rounded-full border transition ${
                    on ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                       : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>
                  {b.brandName}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block">
          <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">
            ข้อความโปรโมชั่น (ส่งลูกค้าทาง LINE เมื่อลูกค้าแอด OA จาก QR ของ event นี้)
          </span>
          <textarea value={draft.linePromoMessage} onChange={(e) => setDraft({ ...draft, linePromoMessage: e.target.value })}
            rows={3} className={inputCls} placeholder="เช่น 🎉 พิเศษเฉพาะงานนี้ รับส่วนลดเพิ่ม 5,000 บาท จองภายในงาน!" />
        </label>

        <div>
          <span className="text-[11px] font-medium text-[var(--text-2)] mb-2 block">
            เป้ารายเซลส์ (เว้นว่าง = ไม่ร่วม event) — แสดงเฉพาะคนที่ขายยี่ห้อที่เลือกไว้ด้านบนได้ (กำหนดยี่ห้อที่ขายได้ที่หน้าผู้ใช้และสิทธิ์)
          </span>
          <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
            {draft.brandIds.length === 0 && <p className="text-[.76rem] text-[var(--text-3)] md:col-span-2">เลือกยี่ห้อที่ไปออกก่อน เพื่อกรองรายชื่อเซลส์ที่ขายยี่ห้อนั้นได้</p>}
            {eligibleUsers.map((u) => (
              <label key={u.userId} className="flex items-center gap-2 text-[.8rem]">
                <span className="flex-1 truncate">{u.displayName}</span>
                <input type="number" min={0}
                  value={draft.targets.find((t) => t.userId === u.userId)?.targetLeads ?? ""}
                  onChange={(e) => setTarget(u.userId, e.target.value)}
                  className="w-20 px-2 py-1 text-sm bg-white border border-[var(--border-2)] rounded-lg text-right" placeholder="—" />
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingId === null ? "สร้าง Event" : "บันทึกการแก้ไข"}
          </button>
          {editingId !== null && (
            <button onClick={cancel} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">
              <X size={14} /> ยกเลิก
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
