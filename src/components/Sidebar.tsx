"use client";

// Left main menu v2 (mockup-faithful): brand block (elephant logo + app name)
// at the top; the collapse toggle is a ☰ button right-aligned on the first
// section row; sections grouped by role. Collapses to an icon rail
// (localStorage). role=null → auth disabled → show everything.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  KanbanSquare, Inbox, LayoutDashboard, Users, Store, Share2, Activity, Menu, X,
  Car, ListChecks, CalendarRange, TrendingUp, FileBarChart, ScrollText, Workflow,
  LogOut, KeyRound, ChevronDown, MapPin, UsersRound, FileText, UserCog, MessageCircle, Timer,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Me } from "@/components/Chrome";
import { EditProfileModal } from "@/components/EditProfileModal";
import { menuKeyForPath, settingsLandingHref } from "@/lib/menuAccess";

const ROLE_TH: Record<string, string> = { admin: "Admin / Owner", gm: "GM", manager: "ผู้จัดการขาย", sales: "เซลส์" };

// Signed-in user chip — lives in the page Header (user req 2026-07-08:
// moving it into the sidebar as a menu row was wrong, reverted back to the
// header the same day). "header" variant is a compact right-aligned pill;
// "sidebar" variant (mobile drawer only) is the older full-width row.
export function UserRow({ me, variant = "header", onSaved }: { me: Me; variant?: "header" | "sidebar"; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  if (!me.user) return null;

  const avatar = me.user.pictureUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={me.user.pictureUrl} alt="" className="h-7 w-7 rounded-lg object-cover border border-[var(--border)] shrink-0" />
    : <div className="h-7 w-7 rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)] flex items-center justify-center text-[.66rem] font-semibold shrink-0">{me.user.displayName.slice(0, 2)}</div>;

  // Header variant collapses to just the avatar circle on small screens (user
  // req 2026-07-10: full name text was wrapping/overflowing on mobile) — the
  // sidebar-drawer variant always shows the full row since there's room there.
  const nameBlockCls = variant === "header" ? "hidden sm:block" : "";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 rounded-[11px] transition hover:bg-[var(--surface-2)] px-2.5 py-1.5 ${variant === "sidebar" ? "w-full" : ""}`}>
        {avatar}
        <div className={`leading-tight text-left min-w-0 ${nameBlockCls}`}>
          <span className="text-[.82rem] font-semibold block truncate">{me.user.displayName}</span>
          <span className="text-[.62rem] text-[var(--text-3)]">{ROLE_TH[me.user.role] ?? me.user.role}</span>
        </div>
        <ChevronDown size={13} className={`text-[var(--text-3)] shrink-0 ${nameBlockCls}`} />
      </button>
      {open && (
        <div className={`absolute top-[calc(100%+4px)] bg-[var(--surface)] border border-[var(--border)] rounded-[14px] shadow-[var(--shadow)] py-1.5 z-30 min-w-[10rem] ${variant === "header" ? "right-0" : "left-0 right-0"}`}>
          <button onClick={() => { setEditing(true); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[.82rem] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition">
            <UserCog size={15} /> แก้ไขโปรไฟล์
          </button>
          <a href="/account/password" className="flex items-center gap-2.5 px-3.5 py-2 text-[.82rem] text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition">
            <KeyRound size={15} /> เปลี่ยนรหัสผ่าน
          </a>
          <div className="h-px bg-[var(--border)] my-1.5" />
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[.82rem] text-[var(--red)] hover:bg-[var(--red-soft)] transition">
            <LogOut size={15} /> ออกจากระบบ
          </button>
        </div>
      )}
      {editing && (
        <EditProfileModal
          initial={{ displayName: me.user.displayName, nickname: me.user.nickname, phone: me.user.phone }}
          onClose={() => setEditing(false)}
          onSaved={() => onSaved?.()}
        />
      )}
    </div>
  );
}

type Item = { href: string; label: string; icon: React.ReactNode; external?: boolean };
const SECTIONS: { caption: string; roles: string[] | null; items: Item[] }[] = [
  {
    caption: "งานขาย · เซลส์",
    roles: null, // everyone
    items: [
      { href: "/leads", label: "Pipeline ของฉัน", icon: <KanbanSquare size={16} /> },
      { href: "/chat", label: "แชทลูกค้า", icon: <MessageCircle size={16} /> },
      { href: "/pool", label: "Lead Pool", icon: <Inbox size={16} /> },
      // Moved out of "ผู้จัดการ" (user-found bug 2026-07-14): that section
      // is gated at the SECTION level to manager/gm/admin, which dropped
      // /runrate for sales before the per-item menuKey check (menuAccess.ts)
      // ever ran — adding "sales" there alone did nothing. Belongs here
      // anyway: a sales viewer sees only their own numbers on this page.
      { href: "/runrate", label: "Run Rate เป้าเดือน", icon: <TrendingUp size={16} /> },
    ],
  },
  {
    caption: "ผู้จัดการ",
    roles: ["manager", "gm", "admin"],
    items: [
      { href: "/dashboard", label: "Dashboard ทีม", icon: <LayoutDashboard size={16} /> },
      { href: "/lead-center", label: "ศูนย์รวม Lead", icon: <ListChecks size={16} /> },
      { href: "/events", label: "Event / บูธ", icon: <CalendarRange size={16} /> },
      { href: "/reports", label: "รายงาน", icon: <FileBarChart size={16} /> },
    ],
  },
  {
    // Manager now gets a delegated slice of settings (user req 2026-07-12:
    // teams/models/quotation-options/conversion-rates) — the href is
    // resolved dynamically per-user in NavList (settingsLandingHref), since
    // the right landing page differs by which settings menus they have.
    caption: "ตั้งค่า",
    roles: ["manager", "gm", "admin"],
    items: [
      { href: "/settings/users", label: "ตั้งค่า", icon: <Users size={16} /> },
    ],
  },
];

// Sub-pages that live "inside" the single Settings nav item (shown as an
// inner column by SettingsShell — user req 2026-07-08: consolidate the
// growing settings list under one menu entry).
//
// Grouped into a 2-row grid (user req 2026-07-15: 13 tabs in one scrolling
// row meant the leftmost items took a real scroll to reach) — 4 topic
// groups, 2 per row, a thin vertical divider between the two groups on each
// row. SettingsShell renders this shape directly.
export const SETTINGS_SUBNAV_GROUPS: { label: string; items: { href: string; label: string; icon: React.ReactNode }[] }[][] = [
  [
    {
      label: "องค์กร",
      items: [
        { href: "/settings/users", label: "ผู้ใช้และสิทธิ์", icon: <Users size={15} /> },
        { href: "/settings/teams", label: "ทีมขาย", icon: <UsersRound size={15} /> },
        { href: "/settings/branches", label: "สาขาและแบรนด์", icon: <Store size={15} /> },
      ],
    },
    {
      label: "การขาย",
      items: [
        { href: "/settings/models", label: "รุ่นรถและสี", icon: <Car size={15} /> },
        { href: "/settings/sources", label: "แหล่งที่มาลูกค้า", icon: <MapPin size={15} /> },
        { href: "/settings/quotation-options", label: "ตั้งค่าใบเสนอราคา", icon: <FileText size={15} /> },
        { href: "/settings/conversion-rates", label: "Conversion Rate", icon: <TrendingUp size={15} /> },
      ],
    },
  ],
  [
    {
      label: "LINE",
      items: [
        { href: "/settings/line-oa", label: "LINE OA แต่ละยี่ห้อ", icon: <MessageCircle size={15} /> },
        { href: "/channels", label: "ช่องทาง FB → LINE", icon: <Share2 size={15} /> },
      ],
    },
    {
      label: "ระบบ",
      items: [
        { href: "/settings/sla-rules", label: "กฎ SLA", icon: <Timer size={15} /> },
        { href: "/settings/automation", label: "ระบบอัตโนมัติ", icon: <Workflow size={15} /> },
        { href: "/logs", label: "Log ระบบ", icon: <ScrollText size={15} /> },
        { href: "/status", label: "สถานะระบบ", icon: <Activity size={15} /> },
      ],
    },
  ],
];
const SETTINGS_PREFIXES = ["/settings", "/channels", "/logs", "/status"];

function Logo({ mini }: { mini?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${mini ? "justify-center" : "px-1"}`}>
      {/* Ch.Erawan Group elephant badge — file at public/logo.png; F fallback. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Ch.Erawan Group" className="h-9 w-9 rounded-full object-contain shrink-0"
        onError={(e) => { const el = e.currentTarget; el.style.display = "none"; (el.nextElementSibling as HTMLElement)!.style.display = "flex"; }} />
      <div className="h-9 w-9 rounded-[11px] bg-[var(--primary)] text-[var(--primary-foreground)] hidden items-center justify-center text-sm font-semibold shrink-0">F</div>
      {!mini && (
        <div className="leading-tight min-w-0">
          <b className="text-[.92rem] font-semibold block truncate">Ch.Lead FUN</b>
          <span className="text-[.66rem] text-[var(--text-3)] block truncate">Lead Follow-Up Nudger</span>
        </div>
      )}
    </div>
  );
}

function NavList({ onNavigate, role, menus, mini, onToggleMini, hideCaptions }: {
  onNavigate?: () => void; role: string | null; menus?: string[] | null; mini?: boolean; onToggleMini?: () => void; hideCaptions?: string[];
}) {
  const pathname = usePathname();
  // Per-user menu access (user req 2026-07-12): when /api/me supplies the
  // effective menu list, filter item-by-item (and drop sections that end up
  // empty). Without it (auth off, or still loading) fall back to the
  // original role-section behavior.
  const visible = SECTIONS
    .filter((s) => role === null || s.roles === null || s.roles.includes(role))
    .filter((s) => !hideCaptions?.includes(s.caption))
    .map((s) => {
      const items: Item[] = [];
      for (const it of s.items) {
        // The single "ตั้งค่า" item's target page varies by which settings
        // menus this user has (admin/gm land on /settings/users; a manager
        // with only the delegated slice lands on the first page they can
        // actually open) — resolved dynamically instead of the generic
        // per-item menuKeyForPath check below.
        if (it.href === "/settings/users" && s.caption === "ตั้งค่า") {
          const href = settingsLandingHref(menus);
          if (href) items.push({ ...it, href });
          continue;
        }
        if (!menus) { items.push(it); continue; }
        const key = menuKeyForPath(it.href);
        if (key === null || menus.includes(key)) items.push(it);
      }
      return { ...s, items };
    })
    .filter((s) => s.items.length > 0);
  return (
    <nav className="space-y-5">
      {visible.map((s, idx) => (
        <div key={s.caption}>
          {idx > 0 && <div className={`h-px bg-[var(--border)] mb-4 ${mini ? "mx-1.5" : "mx-1"}`} />}
          <div className={`flex items-center mb-1.5 ${mini ? "justify-center" : "px-3"}`}>
            {!mini && <span className="text-[.66rem] font-semibold text-[var(--text-3)] uppercase tracking-wide flex-1">{s.caption}</span>}
            {idx === 0 && onToggleMini && (
              <button onClick={onToggleMini} title={mini ? "ขยายเมนู" : "ย่อเมนู"}
                className="p-1 rounded-md text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition">
                <Menu size={15} />
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {s.items.map((it) => {
              const active = !it.external && (SETTINGS_PREFIXES.some((p) => it.href.startsWith(p))
                ? SETTINGS_PREFIXES.some((p) => pathname.startsWith(p))
                : pathname === it.href || pathname.startsWith(it.href + "/"));
              const cls = `flex items-center gap-2.5 rounded-[11px] text-[.84rem] transition ${mini ? "justify-center p-2.5" : "px-3 py-2"} ${
                active ? "bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium"
                       : "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"}`;
              return it.external ? (
                <a key={it.href} href={it.href} target="_blank" rel="noreferrer" title={mini ? it.label : undefined} className={cls}>
                  {it.icon}{!mini && it.label}
                </a>
              ) : (
                <Link key={it.href} href={it.href} onClick={onNavigate} title={mini ? it.label : undefined} className={cls}>
                  {it.icon}{!mini && it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ role, me, onProfileSaved }: { role: string | null; me?: Me | null; onProfileSaved?: () => void }) {
  const [open, setOpen] = useState(false);       // mobile drawer
  const [mini, setMini] = useState(false);       // desktop icon rail
  useEffect(() => { setMini(localStorage.getItem("sb-mini") === "1"); }, []);
  const toggleMini = () => setMini((m) => { localStorage.setItem("sb-mini", m ? "0" : "1"); return !m; });

  return (
    <>
      {/* desktop — inside the rounded app frame. rounded-l + overflow-hidden
          live here (not on the app shell in Chrome.tsx) — the shell can't
          clip without breaking position:sticky elsewhere in the page; this
          aside is a static rectangle with no sticky descendants, so it's
          safe to clip locally to preserve the frame's rounded left corners. */}
      <aside className={`hidden lg:flex flex-col gap-5 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] p-3.5 transition-all rounded-l-[24px] overflow-hidden ${mini ? "w-[68px]" : "w-[224px]"}`}>
        <Logo mini={mini} />
        <NavList role={role} menus={me?.user?.menus ?? null} mini={mini} onToggleMini={toggleMini} />
        <div className="flex-1" />
        {/* Build version marker + legal footer grouped into ONE flex child
            (bug fixed 2026-07-14: the aside's gap-5 was applying BETWEEN
            them too since they were separate siblings, leaving the version
            marker looking oddly detached above the legal links). */}
        <div className="space-y-1.5">
          {/* Build version marker (user req 2026-07-11) — visible confirmation
              a deploy actually landed, instead of guessing from behavior. */}
          {!mini && process.env.NEXT_PUBLIC_BUILD_VERSION && (
            <div className="text-[10px] text-[var(--text-3)] px-1 select-none">v{process.env.NEXT_PUBLIC_BUILD_VERSION}</div>
          )}
          {/* Legal footer (user req 2026-07-14) — a SaaS handling customer PII
              and running staff logins needs these three links reachable from
              anywhere, not just buried in a settings page. */}
          {!mini && (
            <div className="px-1 space-y-1 select-none">
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-[var(--text-3)]">
                <Link href="/terms" className="hover:underline hover:text-[var(--text-2)]">ข้อกำหนดการใช้งาน</Link>
                <Link href="/privacy" className="hover:underline hover:text-[var(--text-2)]">ความเป็นส่วนตัว</Link>
                <Link href="/cookies" className="hover:underline hover:text-[var(--text-2)]">คุกกี้</Link>
              </div>
              <div className="text-[9px] text-[var(--text-3)]">© 2026 Ch.Erawan Group. All rights reserved.</div>
            </div>
          )}
        </div>
      </aside>

      {/* mobile: hamburger + drawer */}
      <button onClick={() => setOpen(true)}
        className="lg:hidden fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg flex items-center justify-center">
        <Menu size={20} />
      </button>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px]" onClick={() => setOpen(false)}>
          <div className="absolute right-0 top-0 bottom-0 w-64 bg-[var(--panel)] p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <Logo />
              <button onClick={() => setOpen(false)} className="text-[var(--text-3)]"><X size={20} /></button>
            </div>
            {me?.user && <div className="mb-3"><UserRow me={me} variant="sidebar" onSaved={onProfileSaved} /></div>}
            {/* Settings not needed on mobile (user req 2026-07-10) — admin
                config work happens at a desk, not on a phone. */}
            <NavList onNavigate={() => setOpen(false)} role={role} menus={me?.user?.menus ?? null} hideCaptions={["ตั้งค่า"]} />
            <div className="mt-4 pt-3 border-t border-[var(--border)] space-y-1">
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-[var(--text-3)]">
                <Link href="/terms" className="hover:underline">ข้อกำหนดการใช้งาน</Link>
                <Link href="/privacy" className="hover:underline">ความเป็นส่วนตัว</Link>
                <Link href="/cookies" className="hover:underline">คุกกี้</Link>
              </div>
              <div className="text-[9px] text-[var(--text-3)]">© 2026 Ch.Erawan Group. All rights reserved.</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
