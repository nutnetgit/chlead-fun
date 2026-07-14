import Link from "next/link";

// Shared shell for the three legal pages (/terms, /privacy, /cookies) —
// deliberately bare (no app sidebar, see Chrome.tsx BARE_ROUTES) since these
// must be readable by a customer who hasn't signed in, from a QR/LIFF flow,
// or by anyone via the footer link.
export function LegalPage({ title, updatedAt, children }: { title: string; updatedAt: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-5 py-10 space-y-6">
      <div>
        <Link href="/" className="text-[.8rem] text-[var(--accent-text)] hover:underline">&larr; กลับหน้าหลัก</Link>
      </div>
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-6 md:p-8 space-y-5">
        <div>
          <h1 className="text-[1.4rem] font-semibold">{title}</h1>
          <p className="text-[.76rem] text-[var(--text-3)] mt-1">ปรับปรุงล่าสุด: {updatedAt}</p>
        </div>
        <div className="text-[.88rem] leading-relaxed text-[var(--text)] space-y-4 [&_h2]:text-[1rem] [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:text-[.86rem]">
          {children}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[.76rem] text-[var(--text-3)] flex-wrap px-1">
        <Link href="/terms" className="hover:underline hover:text-[var(--accent-text)]">ข้อกำหนดการใช้งาน</Link>
        <Link href="/privacy" className="hover:underline hover:text-[var(--accent-text)]">นโยบายความเป็นส่วนตัว</Link>
        <Link href="/cookies" className="hover:underline hover:text-[var(--accent-text)]">นโยบายคุกกี้</Link>
        <span className="ml-auto">© 2026 Ch.Erawan Group. All rights reserved.</span>
      </div>
    </div>
  );
}
