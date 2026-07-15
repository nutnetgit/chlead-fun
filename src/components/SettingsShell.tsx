"use client";

// Shared shell for every settings-family page (users, branches, models,
// channels, automation, logs, status) — consolidated under one "ตั้งค่า" nav
// entry with a tab bar at the top of the main body (user req 2026-07-08:
// originally a left column, corrected same day to "เมนูแนวนอน อยู่ด้านบนส่วน
// ของ main body").
//
// Redesigned into a 2-row grid, grouped by topic with a thin vertical
// divider between the two groups on each row (user req 2026-07-15: 13 tabs
// in one horizontally-scrolling row meant the leftmost items took a real
// scroll to reach — grouping fixes both the reach problem and gives the tabs
// some visual structure instead of one long undifferentiated strip).
//
// Tabs filtered by menu access (user req 2026-07-12): a manager with only
// the delegated settings slice (teams/models/quotation/conversion-rate/sla-
// rules) shouldn't see tabs for pages they can't open (users, branches,
// LINE OA, etc.) — those still exist for admin/gm, just hidden here
// per-user. A group with every item filtered out doesn't render at all.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SETTINGS_SUBNAV_GROUPS } from "@/components/Sidebar";
import { useMe } from "@/components/Chrome";
import { menuKeyForPath } from "@/lib/menuAccess";

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const menus = me?.user?.menus;
  const allowed = (href: string) => {
    if (!menus) return true;
    const key = menuKeyForPath(href);
    return key === null || menus.includes(key);
  };

  const rows = SETTINGS_SUBNAV_GROUPS
    .map((row) => row.map((g) => ({ ...g, items: g.items.filter((it) => allowed(it.href)) })).filter((g) => g.items.length))
    .filter((row) => row.length);

  return (
    <div className="space-y-4">
      <nav className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-1.5 space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex items-stretch gap-1 flex-wrap">
            {row.map((g, gi) => (
              <div key={g.label} className={`flex items-center gap-1 ${gi > 0 ? "pl-2 border-l border-[var(--border)]" : ""}`}>
                {g.items.map((it) => {
                  const active = pathname === it.href || pathname.startsWith(it.href + "/");
                  return (
                    <Link key={it.href} href={it.href}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[.78rem] whitespace-nowrap transition shrink-0 ${
                        active ? "bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium" : "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`}>
                      {it.icon}{it.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div className="min-w-0 w-full space-y-4">{children}</div>
    </div>
  );
}
