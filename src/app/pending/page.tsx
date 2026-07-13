"use client";

// Waiting room for freshly-registered users. Polls /api/me (live DB state) —
// the moment the admin approves, we prompt a re-login so the session token
// picks up the new role/approval.

import { useEffect, useState } from "react";
import { Hourglass, CheckCircle2 } from "lucide-react";

export default function PendingPage() {
  const [approved, setApproved] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    const check = () =>
      fetch("/api/me").then((r) => r.json()).then((d) => {
        if (d.user?.displayName) setName(d.user.displayName);
        if (d.user?.approved) setApproved(true);
      }).catch(() => {});
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="max-w-sm mx-auto pt-20 text-center space-y-5">
      {approved ? (
        <>
          <CheckCircle2 size={56} className="mx-auto text-[var(--primary)]" />
          <h1 className="text-xl">ได้รับอนุมัติแล้ว 🎉</h1>
          <p className="text-[var(--text-2)] text-[.9rem]">เข้าสู่ระบบใหม่อีกครั้งเพื่อเริ่มใช้งาน</p>
          <a href="/api/auth/signout?callbackUrl=/login"
            className="inline-block px-6 py-2.5 rounded-xl text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)]">
            เข้าสู่ระบบอีกครั้ง
          </a>
        </>
      ) : (
        <>
          <Hourglass size={56} className="mx-auto text-[var(--amber)]" />
          <h1 className="text-xl">รอผู้ดูแลอนุมัติ</h1>
          <p className="text-[var(--text-2)] text-[.9rem]">
            {name ? `คุณ${name} ` : ""}ลงทะเบียนสำเร็จแล้ว — แจ้งผู้ดูแลระบบให้เข้าไปกำหนดบทบาท/สาขา และกดอนุมัติที่เมนู “ผู้ใช้และสิทธิ์”
          </p>
          <p className="text-[.72rem] text-[var(--text-3)]">หน้านี้ตรวจสถานะให้อัตโนมัติทุก 10 วินาที</p>
        </>
      )}
    </div>
  );
}
