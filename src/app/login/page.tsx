"use client";

// Two ways in (user request 2026-07-08): LINE Login (doubles as registration
// — first-timers are created as PENDING and routed to /pending until an admin
// approves them) OR username+password (for staff an admin has provisioned in
// /settings/users — no self-registration this way, username must already exist).

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, LogIn, Eye, EyeOff } from "lucide-react";

function LoginForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/leads";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    } else {
      window.location.href = callbackUrl;
    }
  }

  return (
    <div className="max-w-sm mx-auto pt-10 space-y-5">
      <div className="text-center">
        <img src="/logo.png" alt="ช.เอราวัณ" className="h-14 w-14 rounded-2xl object-contain mx-auto mb-4" />
        <h1 className="text-xl">Ch.Lead FUN</h1>
        <p className="text-[var(--text-2)] text-[.85rem] mt-1">ระบบลูกค้าคาดหวังฝ่ายขาย · Ch.Erawan Group</p>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-5 space-y-3">
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ชื่อผู้ใช้</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus
              className="w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
              placeholder="ชื่อผู้ใช้ที่ผู้ดูแลตั้งให้" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รหัสผ่าน</span>
            <div className="relative">
              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} required
                className="w-full px-3 py-2 pr-9 text-sm bg-white border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                placeholder="••••••••" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text)]">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>
          {error && <p className="text-xs text-[var(--red)]">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
            เข้าสู่ระบบด้วยรหัสผ่าน
          </button>
        </form>
      </div>

      <div className="flex items-center gap-2 text-[.68rem] text-[var(--text-3)]">
        <span className="flex-1 border-t border-[var(--border)]" /> หรือ <span className="flex-1 border-t border-[var(--border)]" />
      </div>

      <form
        action={async () => { await signIn("line", { callbackUrl }); }}
      >
        <button type="submit"
          className="w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-[.95rem] font-medium bg-[#06C755] text-white hover:opacity-90 transition shadow-[var(--shadow)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.03 3.6 7.4 8.46 8.04.33.07.78.22.9.5.1.26.07.66.03.92l-.14.87c-.05.26-.21 1.02.9.56 1.1-.47 5.96-3.5 8.13-6C21.77 13.32 22 11.79 22 10.13 22 5.64 17.52 2 12 2z"/></svg>
          เข้าสู่ระบบด้วย LINE
        </button>
      </form>
      <p className="text-[.72rem] text-[var(--text-3)] text-center leading-relaxed">
        ครั้งแรก? กดปุ่มเดียวกัน — ระบบลงทะเบียนให้อัตโนมัติ แล้วรอผู้ดูแลอนุมัติ
      </p>
      <div className="flex items-center justify-center gap-3 text-[10px] text-[var(--text-3)] pt-2">
        <Link href="/terms" className="hover:underline">ข้อกำหนดการใช้งาน</Link>
        <Link href="/privacy" className="hover:underline">ความเป็นส่วนตัว</Link>
        <Link href="/cookies" className="hover:underline">คุกกี้</Link>
      </div>
      <p className="text-[10px] text-[var(--text-3)] text-center">© 2026 Ch.Erawan Group. All rights reserved.</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
