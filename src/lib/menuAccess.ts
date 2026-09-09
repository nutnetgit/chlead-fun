// Per-user menu permissions — the single registry both the server (/api/me,
// /api/users, requirePerm) and the client (Sidebar, Chrome page gate,
// settings editor) resolve against. Pure module: no prisma/server imports,
// so client components can use it too.
//
// Model (user req 2026-09-09, replacing the 2026-07-12 {"menuKey": bool}
// JSON overrides): the legacy SPS shape — one row per user × menu carrying
// six flags (add / edit / cancel / del / report / viewall), and a row
// existing at all = the user can VIEW that menu. It's the same table shape
// as SPS `user_menu` (u_me_add …) so the DMS team can sync permissions in
// either direction; MENU_DEFS[].legacyCode names the closest SPS menu code.
//
// A user with NO rows falls back to their role's default matrix below —
// exactly what SPS does when it materialises a new user from
// user_menu_department. The defaults reproduce the app's behaviour before
// this change (sales own-only, manager branch-scoped with a delegated
// settings slice, gm/admin everything), so nobody's access moved.
//
// Enforcement: server routes call requirePerm(menuKey, flag) (src/lib/authz.ts)
// for mutations/exports; the UI hides menus and buttons from the same map.
// The `viewall` flag lifts branch/owner scoping for that menu (legacy: "ไม่ติ๊ก
// = เห็นเฉพาะของตัวเอง/สาขาตัวเอง").

export type MenuKey =
  | "leads" | "chat" | "pool"
  | "dashboard" | "lead-center" | "runrate" | "events" | "reports"
  | "settings-teams" | "settings-models" | "settings-quotation" | "settings-conversion-rate" | "settings-sla-rules" | "settings-channels"
  | "settings";

export type PermFlag = "add" | "edit" | "cancel" | "del" | "report" | "viewall";
export const PERM_FLAGS: PermFlag[] = ["add", "edit", "cancel", "del", "report", "viewall"];
export const PERM_FLAG_TH: Record<PermFlag, string> = {
  add: "เพิ่ม", edit: "แก้ไข", cancel: "ยกเลิก", del: "ลบ", report: "รายงาน", viewall: "เห็นทุกสาขา",
};
export type PermFlags = Record<PermFlag, boolean>;
// Key present = can view that menu.
export type PermMap = Partial<Record<MenuKey, PermFlags>>;

export const MENU_DEFS: { key: MenuKey; label: string; roles: string[] | null; legacyCode?: string; group: "งานขาย" | "ผู้จัดการ" | "ตั้งค่า" }[] = [
  { key: "leads", label: "Pipeline ของฉัน", roles: null, legacyCode: "pros2", group: "งานขาย" }, // null = every role
  { key: "chat", label: "แชทลูกค้า", roles: null, legacyCode: "pros1", group: "งานขาย" },
  { key: "pool", label: "Lead Pool", roles: null, legacyCode: "pros6", group: "งานขาย" },
  { key: "dashboard", label: "Dashboard ทีม", roles: ["manager", "gm", "admin"], legacyCode: "pros4", group: "ผู้จัดการ" },
  { key: "lead-center", label: "ศูนย์รวม Lead", roles: ["manager", "gm", "admin"], legacyCode: "pros5", group: "ผู้จัดการ" },
  // Sales included (user req 2026-07-14): a sales user sees only their own
  // numbers on this page; the "ตั้งเป้าจอง (ผจก.)" card stays manager+-only.
  { key: "runrate", label: "Run Rate เป้าเดือน", roles: ["sales", "manager", "gm", "admin"], legacyCode: "sps15", group: "งานขาย" },
  { key: "events", label: "Event / บูธ", roles: ["manager", "gm", "admin"], legacyCode: "sps20", group: "ผู้จัดการ" },
  { key: "reports", label: "รายงาน", roles: ["manager", "gm", "admin"], legacyCode: "sps15", group: "ผู้จัดการ" },
  // Manager's slice of settings (user req 2026-07-12).
  { key: "settings-teams", label: "ตั้งค่า: ทีมขาย", roles: ["manager", "gm", "admin"], legacyCode: "sps69", group: "ตั้งค่า" },
  { key: "settings-models", label: "ตั้งค่า: รุ่นรถและสี", roles: ["manager", "gm", "admin"], legacyCode: "sps4", group: "ตั้งค่า" },
  { key: "settings-quotation", label: "ตั้งค่า: ใบเสนอราคา", roles: ["manager", "gm", "admin"], legacyCode: "pros7", group: "ตั้งค่า" },
  { key: "settings-conversion-rate", label: "ตั้งค่า: Conversion Rate", roles: ["manager", "gm", "admin"], group: "ตั้งค่า" },
  // Split out from the admin catch-all (user req 2026-07-15). A manager's
  // write access is scoped server-side to brands they manage.
  { key: "settings-sla-rules", label: "ตั้งค่า: กฎ SLA", roles: ["manager", "gm", "admin"], group: "ตั้งค่า" },
  // Split out 2026-07-19 so a test/reviewer account can be granted just the
  // Channels page. /api/channels is still admin/gm-only server-side.
  { key: "settings-channels", label: "ตั้งค่า: ช่องทางรับ Lead", roles: ["admin", "gm"], legacyCode: "pros3", group: "ตั้งค่า" },
  // Everything else under /settings (users, branches, LINE OA, sources,
  // automation, logs, status) — admin/gm only.
  { key: "settings", label: "ตั้งค่า (ส่วนแอดมิน)", roles: ["admin", "gm"], legacyCode: "sps1", group: "ตั้งค่า" },
];

export const MENU_LABEL: Record<MenuKey, string> = Object.fromEntries(MENU_DEFS.map((m) => [m.key, m.label])) as Record<MenuKey, string>;

const f = (add = 0, edit = 0, cancel = 0, del = 0, report = 0, viewall = 0): PermFlags =>
  ({ add: !!add, edit: !!edit, cancel: !!cancel, del: !!del, report: !!report, viewall: !!viewall });
const ALL = f(1, 1, 1, 1, 1, 1);

// Role default matrix — reproduces pre-2026-09-09 behaviour exactly:
//  sales:   own leads only (viewall 0), may create/edit/mark-lost their own
//           lead, chat, claim from pool, see own Run Rate; no delete/export.
//  manager: branch-scoped (viewall 0); forfeit = cancel on leads/lead-center;
//           report on the manager pages; the delegated settings slice.
//  gm/admin: every flag on every menu they have.
export const ROLE_DEFAULT_PERMS: Record<string, PermMap> = {
  sales: {
    leads: f(1, 1, 1, 0, 0, 0),
    chat: f(1, 1, 0, 0, 0, 0),
    pool: f(0, 1, 0, 0, 0, 0),
    runrate: f(0, 0, 0, 0, 0, 0),
  },
  manager: {
    leads: f(1, 1, 1, 0, 1, 0),
    chat: f(1, 1, 0, 0, 0, 0),
    pool: f(0, 1, 1, 0, 0, 0),
    dashboard: f(0, 0, 0, 0, 1, 0),
    "lead-center": f(0, 1, 1, 0, 1, 0),
    runrate: f(0, 1, 0, 0, 1, 0),
    events: f(1, 1, 1, 1, 1, 0),
    reports: f(0, 0, 0, 0, 1, 0),
    "settings-teams": f(1, 1, 0, 1, 0, 0),
    "settings-models": f(1, 1, 0, 1, 0, 0),
    "settings-quotation": f(1, 1, 0, 1, 0, 0),
    "settings-conversion-rate": f(0, 1, 0, 0, 0, 0),
    "settings-sla-rules": f(1, 1, 0, 1, 0, 0),
  },
  gm: Object.fromEntries(MENU_DEFS.filter((m) => m.roles === null || m.roles.includes("gm")).map((m) => [m.key, ALL])) as PermMap,
  admin: Object.fromEntries(MENU_DEFS.filter((m) => m.roles === null || m.roles.includes("admin")).map((m) => [m.key, ALL])) as PermMap,
};

export function roleDefaultPerms(role: string): PermMap {
  return ROLE_DEFAULT_PERMS[role] ?? {};
}
export function roleDefaultMenus(role: string): MenuKey[] {
  return Object.keys(roleDefaultPerms(role)) as MenuKey[];
}

const VALID_KEYS = new Set<string>(MENU_DEFS.map((m) => m.key));
export const isMenuKey = (k: string): k is MenuKey => VALID_KEYS.has(k);

export type UserMenuRowLike = {
  menuKey: string;
  canAdd: number | boolean; canEdit: number | boolean; canCancel: number | boolean;
  canDel: number | boolean; canReport: number | boolean; canViewall: number | boolean;
};

// rows → effective map. Any rows at all = rows are authoritative (a user the
// admin has customised); none = role defaults.
export function resolvePerms(role: string, rows: UserMenuRowLike[] | null | undefined): PermMap {
  if (!rows || rows.length === 0) return roleDefaultPerms(role);
  const out: PermMap = {};
  for (const r of rows) {
    if (!isMenuKey(r.menuKey)) continue;
    out[r.menuKey] = { add: !!r.canAdd, edit: !!r.canEdit, cancel: !!r.canCancel, del: !!r.canDel, report: !!r.canReport, viewall: !!r.canViewall };
  }
  return out;
}

export function resolveMenus(role: string, rows: UserMenuRowLike[] | null | undefined): MenuKey[] {
  return Object.keys(resolvePerms(role, rows)) as MenuKey[];
}

export function hasPerm(perms: PermMap | null | undefined, key: MenuKey, flag?: PermFlag): boolean {
  const p = perms?.[key];
  if (!p) return false;
  return flag ? !!p[flag] : true;
}

// PermMap → rows for storage (fun_user_menu).
export function permsToRows(perms: PermMap): { menuKey: MenuKey; canAdd: number; canEdit: number; canCancel: number; canDel: number; canReport: number; canViewall: number }[] {
  return (Object.entries(perms) as [MenuKey, PermFlags][]).filter(([k]) => isMenuKey(k)).map(([menuKey, p]) => ({
    menuKey, canAdd: +!!p.add, canEdit: +!!p.edit, canCancel: +!!p.cancel, canDel: +!!p.del, canReport: +!!p.report, canViewall: +!!p.viewall,
  }));
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
  ["/channels", "settings-channels"],
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
// manager with only the delegated pages lands somewhere real instead of a
// blocked page. Returns null if the user has no settings access at all.
const SETTINGS_LANDING: { key: MenuKey; href: string }[] = [
  { key: "settings", href: "/settings/users" },
  { key: "settings-teams", href: "/settings/teams" },
  { key: "settings-models", href: "/settings/models" },
  { key: "settings-quotation", href: "/settings/quotation-options" },
  { key: "settings-conversion-rate", href: "/settings/conversion-rates" },
  { key: "settings-sla-rules", href: "/settings/sla-rules" },
  { key: "settings-channels", href: "/channels" },
];

export function settingsLandingHref(menus: string[] | null | undefined): string | null {
  if (!menus) return null;
  const hit = SETTINGS_LANDING.find((s) => menus.includes(s.key));
  return hit ? hit.href : null;
}
