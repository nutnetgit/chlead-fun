"use client";

// Shared shell for every settings-family page (users, branches, models,
// channels, automation, logs, status) — consolidated under one "ตั้งค่า" nav
// entry with a horizontal tab bar at the top of the main body (user req
// 2026-07-08: originally a left column, corrected same day to "เมนูแนวนอน
// อยู่ด้านบนส่วนของ main body").
//
// Tabs filtered by menu access (user req 2026-07-12): a manager with only
// the delegated settings slice (teams/models/quotation/conversion-rate)
// shouldn't see tabs for pages they can't open (users, branches, LINE OA,
// etc.) — those still exist for admin/gm, just hidden here per-user.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SUBNAV } from "@/components/Sidebar";
import { useMe } from "@/components/Chrome";
import { menuKeyForPath } from "@/lib/menuAccess";

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const menus = me?.user?.menus;
  const tabs = menus
    ? SETTINGS_SUBNAV.filter((it) => {
        const key = menuKeyForPath(it.href);
        return key === null || menus.includes(key);
      })
    : SETTINGS_SUBNAV;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-1.5">
        {tabs.map((it) => {
          const active = pathname === it.href || pathname.startsWith(it.href + "/");
          return (
            <Link key={it.href} href={it.href}
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[.78rem] whitespace-nowrap transition shrink-0 ${
                active ? "bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium" : "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}>
              {it.icon}{it.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 w-full space-y-4">{children}</div>
    </div>
  );
}
