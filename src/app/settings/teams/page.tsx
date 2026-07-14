"use client";

// Sales team management (user req 2026-07-08: "มีการจัดการทีมการขาย ใช้หน้า
// ตั้งทีมขายที่อยู่ใน runrate and event" — fun_team + FunUser.teamId already
// existed in the schema but had no UI; runrate/events only ever had
// per-salesperson targets, not real team grouping). Member assignment is a
// single-select pill toggle (FunUser.teamId is one FK, not many-to-many).

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Loader2, X, Trash2 } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";
import { useMe } from "@/components/Chrome";

type TeamRow = { teamId: number; teamName: string; branchId: number | null; branchName: string | null; managerUserId: number | null; memberCount: number };
type BranchRow = { branchId: number; branchName: string; brandId: number | null };
type UserRow = { userId: number; displayName: string; role: string; teamId: number | null; branchId: number | null; branchIds: number[] };

type Draft = { teamName: string; branchId: string; managerUserId: string };
const EMPTY: Draft = { teamName: "", branchId: "", managerUserId: "" };

export default function TeamsPage() {
  const me = useMe();
  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => fetch("/api/teams").then((r) => r.json()).then(setTeams);
  useEffect(() => {
    load();
    fetch("/api/branches?all=1").then((r) => r.json()).then((d) => setBranches(d.branches));
    fetch("/api/users?all=1").then((r) => r.json()).then(setUsers);
  }, []);

  const managerName = (id: number | null) => users.find((u) => u.userId === id)?.displayName ?? "—";
  const managers = users.filter((u) => u.role === "manager" || u.role === "gm");

  // Brand scoping (user req 2026-07-14: "ต้อง filter เซลล์ ตามยี่ห้อด้วย") —
  // a team belongs to one branch, so its brand is unambiguous. The member
  // picker for a given team should only offer salespeople who actually sell
  // that brand, not the whole company roster. Also scopes the branch
  // dropdown in the create/edit form for a manager to their own branches.
  const brandForBranch = (branchId: number | null) => branchId ? branches.find((b) => b.branchId === branchId)?.brandId ?? null : null;
  const userBrandIds = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const u of users) {
      const ids = new Set([...(u.branchIds ?? []), ...(u.branchId ? [u.branchId] : [])]);
      const brandIds = new Set([...ids].map((bid) => brandForBranch(bid)).filter((x): x is number => x !== null));
      m.set(u.userId, brandIds);
    }
    return m;
  }, [users, branches]);
  const eligibleMembers = (t: TeamRow) => {
    const brandId = brandForBranch(t.branchId);
    // A CURRENT member must always show (bug found 2026-07-14: the brand
    // filter hid anyone already in the team whose branch data no longer
    // matched that brand, leaving no pill to click and no way to remove
    // them) — brand-scoping only decides who's offered as a NEW candidate.
    return users.filter((u) =>
      (u.role === "sales" || u.role === "manager") &&
      (u.teamId === t.teamId || brandId === null || userBrandIds.get(u.userId)?.has(brandId)));
  };

  const isManager = me?.user?.role === "manager";
  const myBranchOptions = isManager
    ? branches.filter((b) => users.find((u) => u.userId === me?.user?.funUserId)?.branchIds?.includes(b.branchId) || users.find((u) => u.userId === me?.user?.funUserId)?.branchId === b.branchId)
    : branches;

  // Edit form sits at the very bottom of a long team list — scroll it into
  // view on แก้ไข (same fix as /settings/users: clicking edit looked like
  // nothing happened because the form was off-screen).
  const editFormRef = useRef<HTMLDivElement>(null);
  const startEdit = (t: TeamRow) => {
    setEditingId(t.teamId);
    setDraft({ teamName: t.teamName, branchId: t.branchId ? String(t.branchId) : "", managerUserId: t.managerUserId ? String(t.managerUserId) : "" });
    setTimeout(() => editFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    if (!draft.teamName.trim()) { setError("ต้องระบุชื่อทีม"); return; }
    if (isManager && !draft.branchId) { setError("เลือกสาขาของทีมก่อน"); return; }
    setSaving(true); setError(null);
    const body = {
      teamName: draft.teamName,
      branchId: draft.branchId ? Number(draft.branchId) : null,
      managerUserId: draft.managerUserId ? Number(draft.managerUserId) : null,
    };
    const res = await fetch(editingId === null ? "/api/teams" : `/api/teams/${editingId}`, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) { cancel(); load(); } else { setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ"); }
    setSaving(false);
  }

  async function removeTeam(t: TeamRow) {
    if (!confirm(`ลบทีม "${t.teamName}"? (ลบได้เฉพาะเมื่อไม่มีสมาชิก)`)) return;
    const res = await fetch(`/api/teams/${t.teamId}`, { method: "DELETE" });
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
    load();
  }

  // Member toggle: reuses PUT /api/users/[id] (single teamId FK per user).
  async function toggleMember(u: UserRow, teamId: number) {
    const nextTeamId = u.teamId === teamId ? null : teamId;
    await fetch(`/api/users/${u.userId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamId: nextTeamId }),
    });
    const usersRes = await fetch("/api/users?all=1").then((r) => r.json());
    setUsers(usersRes);
    load();
  }

  return (
    <SettingsShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-[1.5rem]">ทีมขาย</h1>
          <p className="text-[var(--text-2)] text-[.9rem]">จัดกลุ่มเซลส์เป็นทีม พร้อมผู้จัดการทีม — ผู้ใช้อยู่ได้ทีมเดียว กดชื่อเพื่อเพิ่ม/ถอดจากทีมด้านล่าง</p>
        </div>

        <Card title="ทีมทั้งหมด">
          {teams === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> :
            teams.length === 0 ? <p className="text-sm text-[var(--text-2)]">ยังไม่มีทีม — สร้างทีมแรกด้านล่าง</p> : (
            <div className="space-y-4">
              {teams.map((t) => (
                <div key={t.teamId} className="border border-[var(--border)] rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{t.teamName}</div>
                      <div className="text-[11px] text-[var(--text-3)]">
                        {t.branchName ?? "ไม่ระบุสาขา"} · ผจก. {managerName(t.managerUserId)} · สมาชิก {t.memberCount} คน
                      </div>
                    </div>
                    <button onClick={() => startEdit(t)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title="แก้ไข"><Pencil size={14} /></button>
                    <button onClick={() => removeTeam(t)} className="p-1.5 rounded hover:bg-[var(--red-soft)] text-[var(--red)]" title="ลบ"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {eligibleMembers(t).length === 0 && (
                      <span className="text-[.74rem] text-[var(--text-3)]">ไม่มีเซลส์ที่ขายยี่ห้อนี้ได้ — ตรวจสอบสิทธิ์เข้าสาขาของผู้ใช้ที่หน้าตั้งค่าผู้ใช้</span>
                    )}
                    {eligibleMembers(t).map((u) => {
                      const on = u.teamId === t.teamId;
                      return (
                        <button key={u.userId} type="button" onClick={() => toggleMember(u, t.teamId)}
                          className={`text-[.76rem] px-3 py-1.5 rounded-full border transition ${
                            on ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                               : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
                          {u.displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div ref={editFormRef} className="scroll-mt-4" />
        <Card title={editingId === null ? "สร้างทีม" : `แก้ไขทีม #${editingId}`}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อทีม *</span>
              <input value={draft.teamName} onChange={(e) => setDraft({ ...draft, teamName: e.target.value })} className={inputCls} placeholder="เช่น ทีม Mazda ศาลายา" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สาขา{isManager ? " *" : ""}</span>
              <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className={inputCls}>
                {!isManager && <option value="">— ไม่ระบุ —</option>}
                {isManager && <option value="">— เลือกสาขา —</option>}
                {myBranchOptions.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ผู้จัดการทีม</span>
              <select value={draft.managerUserId} onChange={(e) => setDraft({ ...draft, managerUserId: e.target.value })} className={inputCls}>
                <option value="">— ไม่ระบุ —</option>
                {managers.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
              </select>
            </label>
          </div>
          {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {editingId === null ? "สร้างทีม" : "บันทึกการแก้ไข"}
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
