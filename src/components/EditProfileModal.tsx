"use client";

// Self-service profile edit (user req 2026-07-08): "แก้ไขโปรไฟล์" under the
// header user chip, available to every role. Deliberately scoped to
// non-sensitive fields only — role/branch/username/password stay admin-only
// via /settings/users and /account/password.

import { useState } from "react";
import { Loader2, X, Check } from "lucide-react";

const inputCls = "w-full px-3.5 py-2.5 text-[.95rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";

export function EditProfileModal({
  initial, onClose, onSaved,
}: {
  initial: { displayName: string; nickname: string | null; phone: string | null };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [nickname, setNickname] = useState(initial.nickname ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    if (!displayName.trim()) { setError("ต้องระบุชื่อ-นามสกุล"); return; }
    setSaving(true); setError(null);
    const res = await fetch("/api/account/profile", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, nickname, phone }),
    });
    setSaving(false);
    if (res.ok) { setDone(true); onSaved(); setTimeout(onClose, 900); }
    else setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ");
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">แก้ไขโปรไฟล์</h3>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>

        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">ชื่อ-นามสกุล *</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">ชื่อเล่น</span>
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} className={inputCls} placeholder="เช่น ภว" />
        </label>
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">เบอร์โทร</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="08x-xxx-xxxx" />
        </label>

        {error && <p className="text-[.8rem] text-[var(--red)]">❌ {error}</p>}
        <button onClick={save} disabled={saving || done}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[.9rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
          {done ? <><Check size={15} /> บันทึกแล้ว</> : saving ? <Loader2 size={15} className="animate-spin" /> : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
