"use client";

// App chrome v2 (per approved mockup): rounded frame; logo+nav live in the
// left sidebar. Signed-in user chip lives in the page Header (user req
// 2026-07-08: an earlier same-day change moved it into the sidebar as a menu
// row — reverted the same day, header is correct). Hidden entirely on
// public/auth routes.

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sun, Moon, Lock } from "lucide-react";
import { Sidebar, UserRow } from "@/components/Sidebar";
import { ForcePasswordChange } from "@/components/ForcePasswordChange";
import { menuKeyForPath } from "@/lib/menuAccess";

export type Me = {
  authEnabled: boolean;
  signedIn: boolean;
  user?: {
    funUserId: number; displayName: string; nickname: string | null; phone: string | null; role: string;
    approved: boolean; pictureUrl: string | null; branchId: number | null; mustChangePassword: boolean;
    menus?: string[];
  };
};

const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const BARE_ROUTES = ["/lead-form", "/login", "/pending", "/liff", "/terms", "/privacy", "/cookies"];

// Page gate for per-user menu access (user req 2026-07-12): if the signed-in
// user's effective menus don't include the menu this path belongs to, show a
// blocked panel instead of the page (typing the URL directly gets the same
// wall the hidden sidebar entry implies). UX shaping, not a security
// boundary — API routes keep their own role checks.
function menuBlocked(me: Me | null, pathname: string): boolean {
  if (!me?.authEnabled || !me.user?.menus) return false; // auth off / not loaded yet → old behavior
  const key = menuKeyForPath(pathname);
  return key !== null && !me.user.menus.includes(key);
}

export function Chrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then(setMe).catch(() => setMe({ authEnabled: false, signedIn: false }));
  }, [pathname]);

  useEffect(() => {
    const saved = localStorage.getItem("theme") === "dark";
    setDark(saved);
    document.documentElement.dataset.theme = saved ? "dark" : "light";
  }, []);
  const toggleTheme = () => setDark((d) => {
    const next = !d;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("theme", next ? "dark" : "light");
    return next;
  });

  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) {
    // Legal pages read better a bit wider than the mobile-first forms this
    // wrapper was originally sized for (lead-form/liff); LegalPage.tsx
    // handles its own inner max-width/padding, so this just needs to not
    // clip it down to the narrower form width.
    const isLegal = ["/terms", "/privacy", "/cookies"].some((p) => pathname.startsWith(p));
    return <main className={isLegal ? "" : "max-w-lg mx-auto px-4 py-8"}>{children}</main>;
  }

  const refreshMe = () => fetch("/api/me").then((r) => r.json()).then(setMe);
  const blocked = menuBlocked(me, pathname);

  return (
    <MeContext.Provider value={me}>
      {me?.user?.mustChangePassword && <ForcePasswordChange onDone={refreshMe} />}
      <div className="min-h-screen p-2.5 md:p-5">
        {/* No overflow-hidden here (bug fixed 2026-07-14): it silently breaks
            position:sticky for every descendant, since overflow:hidden makes
            an ancestor a sticky-containment box even though this div itself
            never scrolls (the real scroll happens at the document level) —
            this is why the Pipeline list view's sticky detail panel wasn't
            sticking. Corner-rounding for the sidebar (the only opaque child
            here) is now scoped to the sidebar itself, see Sidebar.tsx. */}
        <div className="max-w-[1400px] mx-auto bg-[var(--panel)] border border-[var(--border)] rounded-[24px] shadow-[var(--shadow)] flex min-h-[calc(100vh-40px)]">
          <Sidebar role={me?.authEnabled && me.user ? me.user.role : null} me={me} onProfileSaved={refreshMe} />

          <div className="flex-1 min-w-0 flex flex-col">
            <header className="h-[60px] shrink-0 px-5 flex items-center justify-between gap-3">
              {/* mobile: compact brand (sidebar hidden) */}
              <div className="flex items-center gap-2 lg:hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="" className="h-7 w-7 rounded-full object-contain"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
                <b className="text-[.9rem] font-semibold">Ch.Lead FUN</b>
              </div>
              <div className="hidden lg:block" />

              <div className="flex items-center gap-2">
                <button onClick={toggleTheme} title={dark ? "โหมดสว่าง" : "โหมดมืด"}
                  className="p-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:text-[var(--text)] transition">
                  {dark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
                {me?.user && <UserRow me={me} onSaved={refreshMe} />}
              </div>
            </header>

            <main className="flex-1 px-4 pb-4 pt-1.5 md:px-6 md:pb-6 md:pt-2 min-w-0">
              {blocked ? (
                <div className="max-w-sm mx-auto pt-20 text-center space-y-3">
                  <div className="h-12 w-12 rounded-2xl bg-[var(--bg)] text-[var(--text-3)] flex items-center justify-center mx-auto"><Lock size={20} /></div>
                  <h1 className="text-lg">ไม่มีสิทธิ์เข้าถึงเมนูนี้</h1>
                  <p className="text-[.85rem] text-[var(--text-2)]">บัญชีของคุณไม่ได้รับสิทธิ์เข้าเมนูนี้ — ติดต่อผู้ดูแลระบบหากต้องการใช้งาน</p>
                </div>
              ) : children}
            </main>
          </div>
        </div>
      </div>
    </MeContext.Provider>
  );
}
