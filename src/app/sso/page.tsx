"use client";

// Landing page for an SPS-issued SSO ticket (docs/SPS_INTEGRATION.md §3.3):
// /sso?ticket=…&to=/leads → consumes the ticket through the "sso" credentials
// provider (src/auth.ts) and continues to the requested page. Bare route (no
// app chrome) — the user has no session yet.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

function SsoInner() {
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = sp.get("ticket") ?? "";
    const to = sp.get("to") ?? "/leads";
    const redirectTo = to.startsWith("/") && !to.startsWith("//") ? to : "/leads";
    if (!ticket) { setError("ไม่พบ ticket"); return; }
    signIn("sso", { ticket, redirect: false }).then((r) => {
      if (!r || r.error) { setError("ticket ใช้ไม่ได้ (หมดอายุหรือถูกใช้แล้ว)"); return; }
      window.location.replace(redirectTo);
    }).catch(() => setError("เข้าสู่ระบบไม่สำเร็จ"));
  }, [sp]);

  return (
    <div className="max-w-sm mx-auto pt-24 text-center space-y-3">
      {error ? (
        <>
          <h1 className="text-lg">เข้าสู่ระบบจาก SPS ไม่สำเร็จ</h1>
          <p className="text-[.85rem] text-[var(--text-2)]">{error} — กลับไปกดลิงก์จาก SPS ใหม่ หรือ <a href="/login" className="underline">เข้าสู่ระบบด้วยตนเอง</a></p>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin mx-auto text-[var(--text-3)]" size={22} />
          <p className="text-[.85rem] text-[var(--text-2)]">กำลังเข้าสู่ระบบจาก SPS…</p>
        </>
      )}
    </div>
  );
}

export default function SsoPage() {
  return <Suspense fallback={null}><SsoInner /></Suspense>;
}
