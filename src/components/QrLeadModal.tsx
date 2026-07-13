"use client";

// Salesperson QR generator (user req 2026-07-08, sequential step-gating):
// steps run top-to-bottom and each is locked until the one above it is
// filled. Sales role: the "เซลส์" field is just their own name, no picker.
// Manager role: picks from their own team's salespeople. Walk-in is always
// selectable; Event is only selectable when the chosen salesperson is
// actually assigned to at least one running event. Brand is then forced to
// either that event's brands or the salesperson's own branch brands.

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, X } from "lucide-react";
import { useMe } from "@/components/Chrome";

type UserRow = { userId: number; displayName: string; role: string; branchId: number | null; branchIds: number[]; teamId: number | null };
type BranchRow = { branchId: number; branchName: string; brandId: number | null; isActive: boolean };
type BrandRow = { brandId: number; brandName: string; liffId: string | null };
type EventRow = { eventId: number; eventName: string; brands: { brandId: number; brandName: string }[]; targets: { userId: number }[] };
type TeamRow = { teamId: number; managerUserId: number | null };

const inputCls = "w-full px-3 py-2 text-sm bg-white border border-[var(--border-2)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:bg-[var(--bg)] disabled:text-[var(--text-3)] disabled:cursor-not-allowed";

export function QrLeadModal({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [f, setF] = useState({ userId: "", source: "", eventId: "", brandId: "", branchId: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/users?all=1").then((r) => r.json()).then((us: UserRow[]) => setUsers(us.filter((u) => u.role === "sales" || u.role === "manager")));
    fetch("/api/teams").then((r) => r.json()).then(setTeams);
    fetch("/api/branches").then((r) => r.json()).then((d) => { setBranches(d.branches); setBrands(d.brands); });
    fetch("/api/events?active=1").then((r) => r.json()).then(setEvents);
  }, []);

  // Step 1: who's eligible to pick. Sales role → just themselves, no choice.
  // Manager role → salespeople on the team(s) they manage; falls back to the
  // full list if they don't manage a team yet (avoids a dead-end UI).
  const myRole = me?.user?.role;
  const myUserId = me?.user?.funUserId;
  const eligibleUsers = useMemo(() => {
    if (myRole === "sales" && myUserId) return users.filter((u) => u.userId === myUserId);
    if (myUserId) {
      const myTeamIds = new Set(teams.filter((t) => t.managerUserId === myUserId).map((t) => t.teamId));
      if (myTeamIds.size) {
        const teamUsers = users.filter((u) => u.teamId !== null && myTeamIds.has(u.teamId));
        if (teamUsers.length) return teamUsers;
      }
    }
    return users;
  }, [users, teams, myRole, myUserId]);

  // Sales users auto-fill to themselves — no picker step needed for them.
  useEffect(() => {
    if (myRole === "sales" && myUserId && !f.userId) setF((cur) => ({ ...cur, userId: String(myUserId) }));
  }, [myRole, myUserId, f.userId]);

  const salesperson = users.find((u) => u.userId === Number(f.userId));
  // Branches this salesperson can work in (home + allowed); all if none set.
  const salesBranches = useMemo(() => {
    if (!salesperson) return [];
    const ids = new Set([...(salesperson.branchIds ?? []), ...(salesperson.branchId ? [salesperson.branchId] : [])]);
    const list = branches.filter((b) => b.isActive && (ids.size === 0 || ids.has(b.branchId)));
    return list.length ? list : branches.filter((b) => b.isActive);
  }, [salesperson, branches]);

  // Events selectable only when this salesperson is actually assigned to them.
  const eventsForSalesperson = useMemo(() => {
    if (!f.userId) return [];
    const uid = Number(f.userId);
    return events.filter((ev) => ev.targets.some((t) => t.userId === uid));
  }, [events, f.userId]);

  // Brands the salesperson sells = brands of their branches; event narrows further.
  const availableBrands = useMemo(() => {
    const branchBrandIds = new Set(salesBranches.map((b) => b.brandId).filter(Boolean) as number[]);
    let list = brands.filter((b) => branchBrandIds.size === 0 || branchBrandIds.has(b.brandId));
    if (f.source === "event" && f.eventId) {
      const ev = eventsForSalesperson.find((e) => e.eventId === Number(f.eventId));
      if (ev && ev.brands.length) {
        const evBrandIds = new Set(ev.brands.map((b) => b.brandId));
        list = list.filter((b) => evBrandIds.has(b.brandId));
      }
    }
    return list;
  }, [brands, salesBranches, f.source, f.eventId, eventsForSalesperson]);
  const brandBranches = salesBranches.filter((b) => !f.brandId || b.brandId === Number(f.brandId) || b.brandId === null);

  // Step gates — each step is locked until the one above it is resolved.
  const salespersonPicked = !!f.userId;
  const sourcePicked = salespersonPicked && !!f.source;
  const sourceResolved = sourcePicked && (f.source === "walkin" || !!f.eventId);
  const brandPicked = sourceResolved && !!f.brandId;

  const ready = brandPicked && !!f.branchId;
  // Must be the public domain, never window.location.origin — a customer's
  // phone scans this on cellular data and can't reach an internal LAN/tunnel
  // address the staff member happened to be viewing the app from (this was a
  // real bug: QR "bounced" to a page that couldn't load, user req 2026-07-08).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "");
  // Per-brand LIFF (user req 2026-07-11): each brand can have its own LINE
  // Login channel + LIFF app — falls back to the legacy shared app for any
  // brand not yet migrated (see /api/branches, src/lib/lineConfig.ts).
  const selectedBrand = brands.find((b) => b.brandId === Number(f.brandId));
  const liffId = selectedBrand?.liffId || process.env.NEXT_PUBLIC_LIFF_ID;
  const qs = `u=${f.userId}&b=${f.brandId}&br=${f.branchId}${f.source === "event" ? `&e=${f.eventId}` : ""}`;
  // LIFF-first order (user req 2026-07-08, add-friend-first): add friend
  // then fill the form, both inside LINE — falls back to the plain web form
  // when no LIFF app is configured yet (desktop scans, LINE not installed).
  // Plain query string on the liff.line.me link — LINE itself wraps it into
  // liff.state during the hand-off redirect (confirmed via live test
  // 2026-07-10: manually adding liff.state here produced DOUBLE nesting,
  // liff.state=?liff.state=..., because LINE wrapped our wrapper). The
  // /liff/register page unwraps liff.state recursively, so both this plain
  // form and any old double-wrapped QR codes still resolve.
  const link = ready
    ? (liffId ? `https://liff.line.me/${liffId}?${qs}` : `${baseUrl}/lead-form?${qs}`)
    : "";
  const qrSrc = link ? `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodeURIComponent(link)}` : "";

  async function copyLink() {
    await navigator.clipboard.writeText(link).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/[0.02] backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">QR รับลูกค้า</h3>
          <button onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text)]"><X size={18} /></button>
        </div>
        <p className="text-[.76rem] text-[var(--text-2)]">ลูกค้าสแกนแล้วกรอกแค่ ชื่อ · เบอร์ · รุ่น — Lead เข้าชื่อเซลส์ที่เลือกทันที พร้อมที่มาอัตโนมัติ</p>

        <label className="block">
          <span className="text-[.72rem] text-[var(--text-2)] block mb-1">เซลส์เจ้าของ Lead *</span>
          {myRole === "sales" ? (
            <div className={inputCls + " bg-[var(--bg)]"}>{salesperson?.displayName ?? "…"}</div>
          ) : (
            <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value, source: "", eventId: "", brandId: "", branchId: "" })} className={inputCls}>
              <option value="">— เลือก —</option>
              {eligibleUsers.map((u) => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
            </select>
          )}
        </label>

        <label className="block">
          <span className="text-[.72rem] text-[var(--text-2)] block mb-1">แหล่งที่มา *</span>
          <div className="flex gap-2">
            <button type="button" disabled={!salespersonPicked} onClick={() => setF({ ...f, source: "walkin", eventId: "", brandId: "", branchId: "" })}
              className={`flex-1 py-2 rounded-lg text-[.8rem] border transition disabled:opacity-40 disabled:cursor-not-allowed ${f.source === "walkin" ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium" : "bg-white border-[var(--border-2)]"}`}>
              Walk-in โชว์รูม
            </button>
            <button type="button" disabled={!salespersonPicked || eventsForSalesperson.length === 0}
              onClick={() => setF({ ...f, source: "event", brandId: "", branchId: "" })}
              className={`flex-1 py-2 rounded-lg text-[.8rem] border transition disabled:opacity-40 disabled:cursor-not-allowed ${f.source === "event" ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium" : "bg-white border-[var(--border-2)]"}`}>
              Event {salespersonPicked && eventsForSalesperson.length === 0 ? "(ไม่มีที่ไปออก)" : ""}
            </button>
          </div>
        </label>
        {f.source === "event" && (
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">Event ที่กำลังจัด *</span>
            <select value={f.eventId} onChange={(e) => setF({ ...f, eventId: e.target.value, brandId: "", branchId: "" })} className={inputCls}>
              <option value="">— เลือก —</option>
              {eventsForSalesperson.map((ev) => <option key={ev.eventId} value={ev.eventId}>{ev.eventName}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">ยี่ห้อ *</span>
            <select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, branchId: "" })} className={inputCls} disabled={!sourceResolved}>
              <option value="">— เลือก —</option>
              {availableBrands.map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[.72rem] text-[var(--text-2)] block mb-1">สาขา *</span>
            <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} className={inputCls} disabled={!brandPicked}>
              <option value="">— เลือก —</option>
              {brandBranches.map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
        </div>

        {ready && (
          <div className="text-center space-y-2 pt-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="QR" width={220} height={220} className="mx-auto rounded-xl border border-[var(--border)]" />
            <p className="text-[.72rem] text-[var(--text-3)] break-all px-2">{link}</p>
            <button onClick={copyLink}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)]">
              {copied ? <><Check size={13} /> คัดลอกแล้ว</> : <><Copy size={13} /> คัดลอกลิงก์</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
