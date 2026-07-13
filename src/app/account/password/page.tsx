"use client";

// Self-service password change, linked from the user-menu dropdown in
// Chrome.tsx. Works whether the account already has a password (LINE-only
// staff setting one for the first time skip the "current password" step —
// the API only requires it when passwordHash is already set).

import { useState } from "react";
import { Loader2, Check, KeyRound } from "lucide-react";
import { Card, inputCls } from "@/components/ui";

export default function AccountPasswordPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

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
    setDone(true);
    setCurrent(""); setNext(""); setConfirm("");
  }

  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-[1.5rem] flex items-center gap-2"><KeyRound size={20} /> เปลี่ยนรหัสผ่าน</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">ใช้เข้าสู่ระบบด้วยชื่อผู้ใช้+รหัสผ่านแทน/นอกเหนือจาก LINE Login</p>
      </div>
      <Card title="ตั้งรหัสผ่านใหม่">
        <p className="text-[.72rem] text-[var(--text-3)]">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</p>
        {done ? (
          <p className="text-sm text-[var(--green)] flex items-center gap-2 py-2"><Check size={16} /> เปลี่ยนรหัสผ่านสำเร็จ</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input type="password" placeholder="รหัสผ่านปัจจุบัน (ถ้ามี)" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputCls} />
            <input type="password" placeholder="รหัสผ่านใหม่" value={next} onChange={(e) => setNext(e.target.value)} required className={inputCls} />
            <input type="password" placeholder="ยืนยันรหัสผ่านใหม่" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={inputCls} />
            {err && <p className="text-xs text-[var(--red)]">❌ {err}</p>}
            <button type="submit" disabled={saving}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null} บันทึกรหัสผ่านใหม่
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
