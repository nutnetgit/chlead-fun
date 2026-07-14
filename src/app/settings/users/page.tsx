"use client";

// User & permission management (admin section). Roles: admin/owner ·
// sales manager · sales. A user has a home branch plus a flexible set of
// allowed branches (fun_user_branch) — branches are per-brand.

import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Loader2, X, KeyRound, Copy, RotateCcw } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";
import { MENU_DEFS, roleDefaultMenus } from "@/lib/menuAccess";

type UserRow = {
  userId: number; displayName: string; nickname: string | null; phone: string | null; role: string;
  branchId: number | null; lineUserid: string | null; isActive: boolean; branchIds: number[];
  approved: boolean; pictureUrl: string | null; username: string | null; hasPassword: boolean;
  menuAccess: Record<string, boolean> | null;
};
type BranchRow = { branchId: number; branchName: string; branchCode: string | null; brandName: string | null; isActive: boolean };

const ROLE_TH: Record<string, string> = { admin: "Admin / Owner", gm: "GM", manager: "ผู้จัดการขาย", sales: "เซลส์" };
const ROLE_BADGE: Record<string, string> = {
  admin: "bg-[var(--red-soft)] text-[var(--red)]",
  gm: "bg-[var(--amber-soft)] text-[var(--amber)]",
  manager: "bg-[var(--accent-soft)] text-[var(--accent-text)]",
  sales: "bg-[var(--bg)] text-[var(--text-2)]",
};

type Draft = {
  displayName: string; nickname: string; phone: string; role: string; branchId: string; lineUserid: string; username: string; branchIds: number[];
  // null = ตาม role; a full {menuKey: bool} map once the admin customises.
  menuAccess: Record<string, boolean> | null;
};
const EMPTY: Draft = { displayName: "", nickname: "", phone: "", role: "sales", branchId: "", lineUserid: "", username: "", branchIds: [], menuAccess: null };

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const load = () => {
    fetch("/api/users?all=1").then((r) => r.json()).then(setUsers);
    fetch("/api/branches?all=1").then((r) => r.json()).then((d) => setBranches(d.branches));
  };
  useEffect(load, []);

  const branchName = (id: number | null) => branches.find((b) => b.branchId === id)?.branchName ?? "—";
  const brandsForBranchIds = (ids: number[]) =>
    [...new Set(ids.map((id) => branches.find((b) => b.branchId === id)?.brandName).filter((x): x is string => !!x))];

  // The edit form lives at the very bottom, below a long user list — scroll
  // it into view on แก้ไข (user req 2026-07-14: clicking edit looked like
  // nothing happened because the form was off-screen).
  const editFormRef = useRef<HTMLDivElement>(null);

  const startEdit = (u: UserRow) => {
    setEditingId(u.userId);
    setTempPassword(null);
    setDraft({
      displayName: u.displayName, nickname: u.nickname ?? "", phone: u.phone ?? "", role: u.role,
      branchId: u.branchId ? String(u.branchId) : "", lineUserid: u.lineUserid ?? "",
      username: u.username ?? "", branchIds: u.branchIds,
      menuAccess: u.menuAccess,
    });
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); setTempPassword(null); };

  async function save() {
    if (!draft.displayName.trim()) { setError("ต้องระบุชื่อ"); return; }
    setSaving(true); setError(null);
    const body = {
      displayName: draft.displayName, nickname: draft.nickname, phone: draft.phone, role: draft.role,
      branchId: draft.branchId ? Number(draft.branchId) : null,
      lineUserid: draft.lineUserid, username: draft.username, branchIds: draft.branchIds,
      ...(editingId !== null ? { menuAccess: draft.menuAccess } : {}),
    };
    const res = await fetch(editingId === null ? "/api/users" : `/api/users/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { cancel(); load(); } else { setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ"); }
    setSaving(false);
  }

  async function resetPassword() {
    if (editingId === null) return;
    if (!draft.username.trim()) { setError("ตั้งชื่อผู้ใช้ก่อนตั้งรหัสผ่าน"); return; }
    setResetting(true); setError(null);
    // Save the username first (in case it just changed), then issue the temp password.
    await fetch(`/api/users/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: draft.username }),
    });
    const res = await fetch(`/api/users/${editingId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resetPassword: true }),
    });
    const data = await res.json().catch(() => ({}));
    setResetting(false);
    if (!res.ok) { setError(data.error ?? "ตั้งรหัสผ่านไม่สำเร็จ"); return; }
    setTempPassword(data.tempPassword ?? null);
    load();
  }

  async function toggleActive(u: UserRow) {
    await fetch(`/api/users/${u.userId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    load();
  }

  const toggleBranch = (id: number) =>
    setDraft((d) => ({ ...d, branchIds: d.branchIds.includes(id) ? d.branchIds.filter((x) => x !== id) : [...d.branchIds, id] }));

  // ── Per-user menu access (user req 2026-07-12) ────────────────────────────
  // Effective state = override map when customised, otherwise the draft
  // role's defaults (so switching the role dropdown live-updates the chips
  // until the admin customises them).
  const effectiveMenuOn = (key: string): boolean => {
    if (draft.menuAccess && typeof draft.menuAccess[key] === "boolean") return draft.menuAccess[key];
    return roleDefaultMenus(draft.role).includes(key as (typeof MENU_DEFS)[number]["key"]);
  };
  const toggleMenu = (key: string) =>
    setDraft((d) => {
      const defaults = roleDefaultMenus(d.role);
      const full = Object.fromEntries(MENU_DEFS.map((m) => [
        m.key,
        d.menuAccess && typeof d.menuAccess[m.key] === "boolean" ? d.menuAccess[m.key] : defaults.includes(m.key),
      ]));
      full[key] = !full[key];
      return { ...d, menuAccess: full };
    });
  const resetMenus = () => setDraft((d) => ({ ...d, menuAccess: null }));

  return (
    <SettingsShell>
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">ผู้ใช้และสิทธิ์</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">Admin/Owner เห็นทุกอย่าง · ผจก. เห็นเฉพาะสาขาที่ได้รับสิทธิ์ · เซลส์เห็นเฉพาะ Lead ตัวเอง — เพิ่ม/ย้ายเซลส์ทีมและกำหนดว่าใครขายยี่ห้อไหนได้ที่หน้านี้ (ยี่ห้อผูกกับสาขา ดังนั้นเลือกสาขาที่เข้าได้ = กำหนดยี่ห้อที่ขายได้ ครอบคลุมเซลส์ที่ทำงานหลายสาขา/หลายยี่ห้อด้วย)</p>
      </div>

      {(users ?? []).some((u) => !u.approved) && (
        <div className="bg-[var(--amber-soft)] border border-[var(--amber)] rounded-2xl p-5 space-y-3">
          <h3 className="text-base font-medium">⏳ รออนุมัติ ({users!.filter((u) => !u.approved).length} คน)</h3>
          <p className="text-[.78rem] text-[var(--text-2)]">สมัครผ่าน LINE Login — กด “แก้ไข” เพื่อกำหนดบทบาท+สาขาก่อน แล้วค่อยกดอนุมัติ (LINE ผูกให้อัตโนมัติแล้ว)</p>
          {users!.filter((u) => !u.approved).map((u) => (
            <div key={u.userId} className="flex items-center gap-3 bg-white rounded-xl px-4 py-2.5">
              {u.pictureUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={u.pictureUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
                : <div className="h-8 w-8 rounded-lg bg-[var(--accent-soft)] flex items-center justify-center text-[.7rem]">{u.displayName.slice(0, 2)}</div>}
              <div className="flex-1">
                <div className="text-sm font-medium">{u.displayName}</div>
                <div className="text-[11px] text-[var(--text-3)]">{ROLE_TH[u.role]} · {u.branchId ? branchName(u.branchId) : "ยังไม่กำหนดสาขา"} · LINE ✓</div>
              </div>
              <button onClick={() => startEdit(u)} className="px-3 py-1.5 rounded-lg text-[.76rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">แก้ไข</button>
              <button
                onClick={async () => {
                  await fetch(`/api/users/${u.userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve: true }) });
                  load();
                }}
                className="px-3 py-1.5 rounded-lg text-[.76rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)]">
                ✓ อนุมัติ
              </button>
            </div>
          ))}
        </div>
      )}

      <Card title="รายชื่อผู้ใช้">
        {users === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> :
          users.length === 0 ? <p className="text-sm text-[var(--text-2)]">ยังไม่มีผู้ใช้ — เพิ่มคนแรกด้านล่าง</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="py-2 pr-3">ชื่อ</th><th className="py-2 pr-3">บทบาท</th>
                  <th className="py-2 pr-3">สาขาหลัก</th><th className="py-2 pr-3">เข้าได้อีก</th>
                  <th className="py-2 pr-3">ขายยี่ห้อได้</th>
                  <th className="py-2 pr-3">LINE</th><th className="py-2 pr-3">ใช้งาน</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.userId} className={`border-b border-[var(--border)] last:border-0 ${!u.isActive ? "opacity-50" : ""}`}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{u.displayName}</div>
                      {u.nickname && <div className="text-[11px] text-[var(--text-3)]">({u.nickname})</div>}
                      {u.username && (
                        <div className="text-[10px] text-[var(--text-3)] font-mono flex items-center gap-1">
                          @{u.username}{u.hasPassword && <span className="text-[var(--green)]" title="ตั้งรหัสผ่านแล้ว">✓</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`text-[.66rem] font-semibold px-2 py-0.5 rounded-full ${ROLE_BADGE[u.role]}`}>{ROLE_TH[u.role] ?? u.role}</span>
                      {u.menuAccess && (
                        <div className="text-[10px] text-[var(--amber)] mt-0.5" title="สิทธิ์เข้าเมนูถูกกำหนดเองรายคน (ไม่ใช่ค่าตามบทบาท)">⚙ เมนูกำหนดเอง</div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">{branchName(u.branchId)}</td>
                    <td className="py-2.5 pr-3 text-[11px] text-[var(--text-2)] max-w-[14rem]">
                      {u.branchIds.length ? u.branchIds.map(branchName).join(", ") : "—"}
                    </td>
                    <td className="py-2.5 pr-3 max-w-[12rem]">
                      <div className="flex flex-wrap gap-1">
                        {brandsForBranchIds(u.branchIds).length
                          ? brandsForBranchIds(u.branchIds).map((b) => (
                              <span key={b} className="text-[.62rem] font-medium bg-[var(--accent-soft)] text-[var(--accent-text)] rounded-full px-2 py-0.5">{b}</span>
                            ))
                          : <span className="text-[11px] text-[var(--text-3)]">—</span>}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-[11px]">{u.lineUserid ? "✓ ผูกแล้ว" : <span className="text-[var(--text-3)]">ยังไม่ผูก</span>}</td>
                    <td className="py-2.5 pr-3"><Toggle on={u.isActive} onClick={() => toggleActive(u)} /></td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => startEdit(u)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไข"><Pencil size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div ref={editFormRef} className="scroll-mt-4" />
      <Card title={editingId === null ? "เพิ่มผู้ใช้" : `แก้ไขผู้ใช้ #${editingId}`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อ-สกุล *</span>
            <input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} className={inputCls} placeholder="เช่น ภัทรวดี ใจดี" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อเล่น</span>
            <input value={draft.nickname} onChange={(e) => setDraft({ ...draft, nickname: e.target.value })} className={inputCls} placeholder="เช่น ภว" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">เบอร์โทร (แสดงให้ลูกค้าตอนแอด LINE OA)</span>
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={inputCls} placeholder="08x-xxx-xxxx" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">บทบาท *</span>
            <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className={inputCls}>
              <option value="sales">เซลส์</option><option value="manager">ผู้จัดการขาย</option>
              <option value="gm">GM</option><option value="admin">Admin / Owner</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สาขาหลัก</span>
            <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className={inputCls}>
              <option value="">— ไม่ระบุ —</option>
              {branches.filter((b) => b.isActive).map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">LINE User ID (สำหรับแจ้งเตือน/ปุ่ม ผจก.)</span>
            <input value={draft.lineUserid} onChange={(e) => setDraft({ ...draft, lineUserid: e.target.value })} className={inputCls + " font-mono text-xs"} placeholder="Uxxxxxxxx…" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อผู้ใช้ (เข้าระบบด้วยรหัสผ่าน แทน/นอกเหนือจาก LINE)</span>
            <input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} className={inputCls + " font-mono text-xs"} placeholder="เช่น patcharawadee" />
          </label>
          {editingId !== null && (
            <div className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รหัสผ่าน</span>
              <button type="button" onClick={resetPassword} disabled={resetting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[.8rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] disabled:opacity-50">
                {resetting ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                ตั้ง/รีเซ็ตรหัสผ่าน (ออกรหัสชั่วคราว)
              </button>
            </div>
          )}
        </div>

        {tempPassword && (
          <div className="bg-[var(--amber-soft)] border border-[var(--amber)] rounded-xl p-3.5 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[.74rem] font-medium text-[var(--amber)]">รหัสผ่านชั่วคราว — ให้ผู้ใช้ครั้งเดียว (ระบบจะไม่แสดงอีก)</p>
              <p className="text-base font-mono font-semibold tracking-wide mt-0.5">{tempPassword}</p>
            </div>
            <button type="button" onClick={() => navigator.clipboard.writeText(tempPassword)}
              className="p-2 rounded-lg border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]" title="คัดลอก">
              <Copy size={14} />
            </button>
          </div>
        )}

        <div>
          <span className="text-[11px] font-medium text-[var(--text-2)] mb-2 block">
            สาขาที่เข้าใช้งานได้ (เลือกได้หลายสาขา แม้ต่างยี่ห้อ — เพราะยี่ห้อผูกกับสาขา การเลือกสาขาคือการกำหนดว่าขายยี่ห้อไหนได้ไปในตัว)
          </span>
          <div className="flex flex-wrap gap-2">
            {branches.filter((b) => b.isActive).map((b) => {
              const on = draft.branchIds.includes(b.branchId);
              return (
                <button key={b.branchId} type="button" onClick={() => toggleBranch(b.branchId)}
                  className={`text-[.76rem] px-3 py-1.5 rounded-full border transition ${
                    on ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                       : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
                  {b.branchName}{b.brandName ? <span className="opacity-60"> · {b.brandName}</span> : ""}
                </button>
              );
            })}
          </div>
          {draft.branchIds.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[.72rem]">
              <span className="text-[var(--text-3)]">→ ขายยี่ห้อได้:</span>
              {brandsForBranchIds(draft.branchIds).map((b) => (
                <span key={b} className="font-medium bg-[var(--accent-soft)] text-[var(--accent-text)] rounded-full px-2 py-0.5">{b}</span>
              ))}
            </div>
          )}
        </div>

        {editingId !== null && (
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[11px] font-medium text-[var(--text-2)]">
                สิทธิ์เข้าเมนู — ติ๊กเปิด/ปิดรายเมนูเฉพาะคนนี้ (ซ่อนจากแถบเมนูและกันเข้าหน้า)
              </span>
              {draft.menuAccess === null ? (
                <span className="text-[.66rem] font-medium bg-[var(--bg)] text-[var(--text-3)] rounded-full px-2 py-0.5">ตามบทบาท {ROLE_TH[draft.role]}</span>
              ) : (
                <>
                  <span className="text-[.66rem] font-medium bg-[var(--amber-soft)] text-[var(--amber)] rounded-full px-2 py-0.5">กำหนดเอง</span>
                  <button type="button" onClick={resetMenus}
                    className="flex items-center gap-1 text-[.7rem] text-[var(--accent-text)] hover:underline">
                    <RotateCcw size={11} /> รีเซ็ตตามบทบาท
                  </button>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {MENU_DEFS.map((m) => {
                const on = effectiveMenuOn(m.key);
                return (
                  <button key={m.key} type="button" onClick={() => toggleMenu(m.key)}
                    className={`text-[.76rem] px-3 py-1.5 rounded-full border transition ${
                      on ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                         : "bg-white border-[var(--border-2)] text-[var(--text-3)] line-through hover:border-[var(--text-3)]"}`}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--text-3)] mt-1.5">
              เมนูตั้งค่า (ทั้งหมวด) รวมทุกหน้าย่อยใน &quot;ตั้งค่า&quot; · ปิดเมนูตั้งค่าของบัญชีตัวเองไม่ได้ · ผู้ใช้เห็นผลทันทีที่โหลดหน้าใหม่
            </p>
          </div>
        )}

        {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingId === null ? "เพิ่มผู้ใช้" : "บันทึกการแก้ไข"}
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
