"use client";

// Blocking overlay shown when the signed-in user has mustChangePassword=1
// (an admin just issued them a temp password in /settings/users). They cannot
// use the app until they set their own password — the admin never learns it.

import { useState } from "react";
import { ShieldAlert, Loader2, Check } from "lucide-react";

export function ForcePasswordChange({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (next !== confirm) { setErr("รหัสผ่านใหม่ไม่ตรงกัน"); return; }
    setSaving(true);
    const res = await fetch("/api/account/password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(data.error || "เปลี่ยนรหัสผ่านไม่สำเร็จ"); return; }
    onDone();
  }

  const cls = "w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/[0.02] backdrop-blur-[2px] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--amber-soft)]">
            <ShieldAlert size={18} className="text-[var(--amber)]" />
          </div>
          <div>
            <h2 className="text-base font-bold">ตั้งรหัสผ่านใหม่ก่อนใช้งาน</h2>
            <p className="text-[11px] text-[var(--text-3)]">เพื่อความปลอดภัย ครั้งแรกต้องเปลี่ยนรหัสชั่วคราว</p>
          </div>
        </div>
        <p className="text-[11px] text-[var(--text-3)]">รหัสใหม่: อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</p>

        <form onSubmit={submit} className="space-y-3">
          <input type="password" placeholder="รหัสผ่านชั่วคราว (ที่ได้รับ)" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus className={cls} />
          <input type="password" placeholder="รหัสผ่านใหม่" value={next} onChange={(e) => setNext(e.target.value)} required className={cls} />
          <input type="password" placeholder="ยืนยันรหัสผ่านใหม่" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={cls} />
          {err && <p className="text-xs text-[var(--red)]">{err}</p>}
          <button type="submit" disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white text-sm font-medium bg-[var(--primary)] hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} บันทึกรหัสผ่านใหม่
          </button>
        </form>

        <a href="/api/auth/signout?callbackUrl=/login" className="block w-full text-center text-[11px] text-[var(--text-3)] hover:text-[var(--text)]">
          ออกจากระบบ
        </a>
      </div>
    </div>
  );
}
