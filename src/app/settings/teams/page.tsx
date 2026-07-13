"use client";

// Sales team management (user req 2026-07-08: "มีการจัดการทีมการขาย ใช้หน้า
// ตั้งทีมขายที่อยู่ใน runrate and event" — fun_team + FunUser.teamId already
// existed in the schema but had no UI; runrate/events only ever had
// per-salesperson targets, not real team grouping). Member assignment is a
// single-select pill toggle (FunUser.teamId is one FK, not many-to-many).

import { useEffect, useState } from "react";
import { Plus, Pencil, Loader2, X, Trash2 } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type TeamRow = { teamId: number; teamName: string; branchId: number | null; branchName: string | null; managerUserId: number | null; memberCount: number };
type BranchRow = { branchId: number; branchName: string };
type UserRow = { userId: number; displayName: string; role: string; teamId: number | null };

type Draft = { teamName: string; branchId: string; managerUserId: string };
const EMPTY: Draft = { teamName: "", branchId: "", managerUserId: "" };

export default function TeamsPage() {
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

  const startEdit = (t: TeamRow) => {
    setEditingId(t.teamId);
    setDraft({ teamName: t.teamName, branchId: t.branchId ? String(t.branchId) : "", managerUserId: t.managerUserId ? String(t.managerUserId) : "" });
  };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    if (!draft.teamName.trim()) { setError("ต้องระบุชื่อทีม"); return; }
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
                    {users.filter((u) => u.role === "sales" || u.role === "manager").map((u) => {
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

        <Card title={editingId === null ? "สร้างทีม" : `แก้ไขทีม #${editingId}`}>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อทีม *</span>
              <input value={draft.teamName} onChange={(e) => setDraft({ ...draft, teamName: e.target.value })} className={inputCls} placeholder="เช่น ทีม Mazda ศาลายา" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สาขา</span>
              <select value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })} className={inputCls}>
                <option value="">— ไม่ระบุ —</option>
                {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
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
