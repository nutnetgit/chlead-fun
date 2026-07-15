// Per-user menu access (user req 2026-07-12) — the single registry both the
// server (/api/me, /api/users) and the client (Sidebar, Chrome page gate,
// settings editor) resolve against. Pure module: no prisma/server imports,
// so client components can use it too.
//
// Model: each role has a default menu set (mirrors the pre-existing role
// sections in the sidebar); fun_user.menu_access (JSON {"key": bool}) then
// overrides per menu, per person. NULL menu_access = pure role defaults, so
// every user behaves exactly as before until an admin edits them.
//
// Settings split (user req 2026-07-12): "settings" used to be one monolithic
// key covering all of /settings/*, admin/gm only. It's now split so manager
// gets its own default slice — teams, models/colors, quotation options,
// conversion rates — while "settings" (everything else: users, branches,
// LINE OA, sources, channels, automation, logs, status) stays admin/gm only.
//
// Enforcement depth (per user decision 2026-07-12): menus hidden from the
// sidebar + page entry blocked in the app shell. API routes keep their own
// role checks (some routes additionally scope managers to their own brands,
// e.g. /api/models — see that route's comments) — this menu layer is
// workflow shaping, not the security boundary by itself.

export type MenuKey =
  | "leads" | "chat" | "pool"
  | "dashboard" | "lead-center" | "runrate" | "events" | "reports"
  | "settings-teams" | "settings-models" | "settings-quotation" | "settings-conversion-rate" | "settings-sla-rules"
  | "settings";

export const MENU_DEFS: { key: MenuKey; label: string; roles: string[] | null }[] = [
  { key: "leads", label: "Pipeline ของฉัน", roles: null }, // null = every role
  { key: "chat", label: "แชทลูกค้า", roles: null },
  { key: "pool", label: "Lead Pool", roles: null },
  { key: "dashboard", label: "Dashboard ทีม", roles: ["manager", "gm", "admin"] },
  { key: "lead-center", label: "ศูนย์รวม Lead", roles: ["manager", "gm", "admin"] },
  // Sales included (user req 2026-07-14 — this key had no "sales" at all, so
  // the page/API's existing self-scoping for a sales viewer was unreachable:
  // the menu item never showed and the sidebar's page gate blocked direct
  // URL entry too. A sales user sees only their own numbers on this page;
  // the "ตั้งเป้าจอง (ผจก.)" card stays manager+-only inside the page itself.
  { key: "runrate", label: "Run Rate เป้าเดือน", roles: ["sales", "manager", "gm", "admin"] },
  { key: "events", label: "Event / บูธ", roles: ["manager", "gm", "admin"] },
  { key: "reports", label: "รายงาน", roles: ["manager", "gm", "admin"] },
  // Manager's slice of settings (user req 2026-07-12).
  { key: "settings-teams", label: "ตั้งค่า: ทีมขาย", roles: ["manager", "gm", "admin"] },
  { key: "settings-models", label: "ตั้งค่า: รุ่นรถและสี", roles: ["manager", "gm", "admin"] },
  { key: "settings-quotation", label: "ตั้งค่า: ใบเสนอราคา", roles: ["manager", "gm", "admin"] },
  { key: "settings-conversion-rate", label: "ตั้งค่า: Conversion Rate", roles: ["manager", "gm", "admin"] },
  // Split out from the admin catch-all (user req 2026-07-15) so a manager
  // can be granted SLA rule access without also getting users/branches/
  // automation/etc. A manager's write access here is scoped server-side to
  // brands they manage (see /api/settings/sla-rules) — same rule as
  // settings-models. NOT the same thing as the "SLA Engine" on/off toggle on
  // /settings/automation (still in the admin-only "settings" bundle below) —
  // that just flips whether the hourly job runs at all; this page sets the
  // actual day/minute thresholds the job uses when it does run.
  { key: "settings-sla-rules", label: "ตั้งค่า: กฎ SLA", roles: ["manager", "gm", "admin"] },
  // Everything else under /settings (users, branches, LINE OA, sources,
  // channels, automation, logs, status) — admin/gm only, unchanged.
  { key: "settings", label: "ตั้งค่า (ส่วนแอดมิน)", roles: ["admin", "gm"] },
];

export function roleDefaultMenus(role: string): MenuKey[] {
  return MENU_DEFS.filter((m) => m.roles === null || m.roles.includes(role)).map((m) => m.key);
}

// role + stored overrides JSON → effective allowed menu list.
export function resolveMenus(role: string, menuAccessJson: string | null | undefined): MenuKey[] {
  let overrides: Record<string, boolean> = {};
  if (menuAccessJson) {
    try { overrides = JSON.parse(menuAccessJson) as Record<string, boolean>; } catch { /* corrupt → role defaults */ }
  }
  return MENU_DEFS
    .filter((m) => (typeof overrides[m.key] === "boolean" ? overrides[m.key] : m.roles === null || m.roles.includes(role)))
    .map((m) => m.key);
}

// Which menu a pathname belongs to (for the page gate + subnav filtering).
// null = not menu-gated (public pages, /pending, /account/password, unknown
// paths). Order matters: specific /settings/* sub-paths are listed before
// the generic "/settings" catch-all since the lookup takes the first match.
const PATH_MENU: [string, MenuKey][] = [
  ["/leads", "leads"],
  ["/chat", "chat"],
  ["/quotes", "chat"],        // quote composer opens from the chat thread
  ["/pool", "pool"],
  ["/dashboard", "dashboard"],
  ["/lead-center", "lead-center"],
  ["/runrate", "runrate"],
  ["/events", "events"],
  ["/reports", "reports"],
  ["/governance", "dashboard"], // SLA exempt page — a manager action off the dashboard
  ["/settings/teams", "settings-teams"],
  ["/settings/models", "settings-models"],
  ["/settings/quotation-options", "settings-quotation"],
  ["/settings/conversion-rates", "settings-conversion-rate"],
  ["/settings/sla-rules", "settings-sla-rules"],
  ["/settings", "settings"],
  ["/channels", "settings"],
  ["/logs", "settings"],
  ["/status", "settings"],
];

export function menuKeyForPath(pathname: string): MenuKey | null {
  const hit = PATH_MENU.find(([p]) => pathname === p || pathname.startsWith(p + "/"));
  return hit ? hit[1] : null;
}

// Landing page for the single "ตั้งค่า" sidebar entry — picks the first
// settings page this user's menus actually allow, in a sensible priority
// order, so admin/gm keep their traditional /settings/users landing while a
// manager with only the 4 delegated pages lands somewhere real instead of a
// blocked page. Returns null if the user has no settings access at all.
const SETTINGS_LANDING: { key: MenuKey; href: string }[] = [
  { key: "settings", href: "/settings/users" },
  { key: "settings-teams", href: "/settings/teams" },
  { key: "settings-models", href: "/settings/models" },
  { key: "settings-quotation", href: "/settings/quotation-options" },
  { key: "settings-conversion-rate", href: "/settings/conversion-rates" },
  { key: "settings-sla-rules", href: "/settings/sla-rules" },
];

export function settingsLandingHref(menus: string[] | null | undefined): string | null {
  if (!menus) return null;
  const hit = SETTINGS_LANDING.find((s) => menus.includes(s.key));
  return hit ? hit.href : null;
}
