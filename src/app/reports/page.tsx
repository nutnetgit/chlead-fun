"use client";

// Manager reports: date/brand/branch/sales filters → funnel + source + brand
// + per-sales tables with conversion, weekly intake trend, and CSV export of
// the filtered leads for downstream work.

import { useEffect, useState, useCallback } from "react";
import { Download } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { useMe } from "@/components/Chrome";

type Agg = { key: string; leads: number; booked: number; rate: number };
type WeeklyBySource = { categories: string[]; weeks: { week: string; counts: Record<string, number> }[] };
type Data = {
  range: { from: string; to: string };
  totals: { leads: number; booked: number; lost: number; active: number; conflicts: number };
  byStage: Agg[]; bySource: Agg[]; byBrand: Agg[]; byOwner: Agg[];
  weekly: { week: string; n: number }[];
  weeklyBySource: WeeklyBySource;
};
type BranchRow = { branchId: number; branchName: string; brandId: number | null; isActive: boolean };
type BrandRow = { brandId: number; brandName: string };
type UserRow = { userId: number; displayName: string; role: string; branchId: number | null; branchIds: number[] };

// Distinct, stable colors per channel category so the same category always
// reads as the same color across the weekly-by-channel chart.
const SOURCE_COLOR: Record<string, string> = {
  walkin: "#F3B01C", phone: "#6B8CB8", online_owned: "#3E8E63", online_paid: "#C24E33",
  oem: "#A16E12", event: "#8A5CF6", referral: "#22B8CF", service: "#B57F06", fleet: "#5C6B73", unknown: "#9B968A",
};

const STAGE_TH: Record<string, string> = {
  new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรอง", appointment: "นัดหมาย",
  test_drive: "ทดลองขับ", negotiation: "ต่อรอง", finance_check: "ไฟแนนซ์", booking: "จอง",
  nurture: "เลี้ยงต่อ", lost: "เสีย", forfeited: "ถูกริบ",
};
const CAT_TH: Record<string, string> = {
  walkin: "Walk-in", phone: "โทรศัพท์", online_owned: "Online เพจ/OA", online_paid: "Online Ads",
  oem: "OEM", event: "Event/บูธ", referral: "แนะนำ", service: "ลูกค้าเก่า", fleet: "Fleet", unknown: "ไม่ระบุ",
};
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
const d10 = (d: Date) => d.toISOString().slice(0, 10);
// week is the Monday-of-week date as "YYYY-MM-DD" (see /api/reports) — user
// req 2026-07-14: display as "DD/MM/YY" instead of the previous "MM-DD".
const fmtWeekDMY = (week: string) => { const [y, m, day] = week.split("-"); return `${day}/${m}/${y.slice(2)}`; };

function AggTable({ title, rows, labelMap }: { title: string; rows: Agg[]; labelMap?: Record<string, string> }) {
  const max = Math.max(1, ...rows.map((r) => r.leads));
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-[var(--text-2)]">ไม่มีข้อมูลในช่วงที่เลือก</p> : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-[.8rem]">
              <span className="w-24 shrink-0 truncate text-[var(--text-2)]">{labelMap?.[r.key] ?? r.key}</span>
              <div className="flex-1 h-4 bg-[var(--surface-2)] rounded-md overflow-hidden">
                <div className="h-full bg-[var(--primary)] rounded-md" style={{ width: `${(r.leads / max) * 100}%` }} />
              </div>
              <span className="w-9 text-right num font-medium">{r.leads}</span>
              <span className="w-20 text-right num text-[.7rem] text-[var(--text-3)]">จอง {r.booked} ({pct(r.rate)})</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const me = useMe();
  const now = new Date();
  const [f, setF] = useState({
    from: d10(new Date(now.getTime() - 90 * 864e5)), to: d10(now),
    brandId: "", branchId: "", ownerId: "",
  });
  const [d, setD] = useState<Data | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  const qs = useCallback(() => {
    const p = new URLSearchParams({ from: f.from, to: f.to });
    if (f.brandId) p.set("brandId", f.brandId);
    if (f.branchId) p.set("branchId", f.branchId);
    if (f.ownerId) p.set("ownerId", f.ownerId);
    return p.toString();
  }, [f]);

  useEffect(() => {
    fetch("/api/branches").then((r) => r.json()).then((x) => { setBrands(x.brands); setBranches(x.branches); });
    fetch("/api/users").then((r) => r.json()).then(setUsers);
  }, []);
  useEffect(() => { setD(null); fetch(`/api/reports?${qs()}`).then((r) => r.json()).then(setD); }, [qs]);

  // Scope the filter dropdowns themselves (user req 2026-07-15: a manager
  // shouldn't even be able to PICK a brand/branch/salesperson outside what
  // they manage, not just get an empty result if they somehow did) — same
  // pattern as Dashboard's brand chips.
  const role = me?.user?.role;
  const self = users.find((u) => u.userId === me?.user?.funUserId);
  const myOwnBranchIds = new Set([...(self?.branchIds ?? []), ...(self?.branchId ? [self.branchId] : [])]);
  const unrestricted = !role || role === "admin" || role === "gm" || myOwnBranchIds.size === 0;
  const myBranches = unrestricted ? branches : branches.filter((b) => myOwnBranchIds.has(b.branchId));
  const myBrandIds = new Set(myBranches.map((b) => b.brandId).filter((x): x is number => x !== null));
  const myBrands = unrestricted ? brands : brands.filter((b) => myBrandIds.has(b.brandId));
  const myUsers = unrestricted ? users : users.filter((u) =>
    u.branchId !== null && myOwnBranchIds.has(u.branchId) || u.branchIds.some((id) => myOwnBranchIds.has(id)));

  const maxWeek = Math.max(1, ...(d?.weekly.map((w) => w.n) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[1.7rem]">รายงาน</h1>
          <p className="text-[var(--text-2)] text-[.95rem]">สถิติ + conversion ตามตัวกรอง และ export เป็น CSV ไปใช้งานต่อ</p>
        </div>
        <a href={`/api/reports/export?${qs()}`}
          className="flex items-center gap-1.5 px-4 py-2 rounded-[11px] text-sm font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95">
          <Download size={15} /> Export CSV
        </a>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="block"><span className="text-[11px] text-[var(--text-2)] block mb-1">จากวันที่</span>
          <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={inputCls} /></label>
        <label className="block"><span className="text-[11px] text-[var(--text-2)] block mb-1">ถึงวันที่</span>
          <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={inputCls} /></label>
        <label className="block"><span className="text-[11px] text-[var(--text-2)] block mb-1">แบรนด์</span>
          <select value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value, branchId: "" })} className={inputCls}>
            <option value="">ทั้งหมด</option>{myBrands.map((b) => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
          </select></label>
        <label className="block"><span className="text-[11px] text-[var(--text-2)] block mb-1">สาขา</span>
          <select value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} className={inputCls}>
            <option value="">ทั้งหมด</option>
            {myBranches.filter((b) => !f.brandId || b.brandId === Number(f.brandId)).map((b) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
          </select></label>
        <label className="block"><span className="text-[11px] text-[var(--text-2)] block mb-1">เซลส์</span>
          <select value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })} className={inputCls}>
            <option value="">ทั้งหมด</option>{myUsers.map((u) => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
          </select></label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: "Lead ทั้งหมด", v: d?.totals.leads, cls: "" },
          { l: "จองได้", v: d?.totals.booked, cls: "text-[var(--green)]" },
          { l: "ยัง active", v: d?.totals.active, cls: "" },
          { l: "เสีย", v: d?.totals.lost, cls: "text-[var(--red)]" },
          { l: "Conversion", v: d ? pct(d.totals.leads ? d.totals.booked / d.totals.leads : 0) : "…", cls: "text-[var(--accent-text)]" },
        ].map((c) => (
          <div key={c.l} className="bg-white border border-[var(--border)] rounded-xl px-4 py-3 shadow-[var(--shadow)]">
            <div className="text-[.7rem] text-[var(--text-2)]">{c.l}</div>
            <div className={`text-xl font-semibold num mt-0.5 ${c.cls}`}>{c.v ?? "…"}</div>
          </div>
        ))}
      </div>

      {/* Capped to 12 weeks server-side + enlarged date/count text (user req
          2026-07-14: bars and labels were too small to read at a glance). */}
      <Card title="Lead เข้าใหม่รายสัปดาห์">
        {!d ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : d.weekly.length === 0 ? <p className="text-sm text-[var(--text-2)]">ไม่มีข้อมูล</p> : (
          <div className="flex items-end gap-2 h-32">
            {d.weekly.map((w) => (
              <div key={w.week} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`Week: ${fmtWeekDMY(w.week)} — ${w.n} ราย`}>
                <span className="text-[.78rem] num font-medium text-[var(--text-2)]">{w.n}</span>
                <div className="w-full bg-[var(--primary)] rounded-t-md" style={{ height: `${(w.n / maxWeek) * 80}px`, minHeight: 3 }} />
                <span className="text-[.68rem] num text-[var(--text-3)] whitespace-nowrap">{fmtWeekDMY(w.week)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Weekly trend split by channel (user req 2026-07-15: "วัดประสิทธิภาพ
          ของ lead ตามช่องทางต่างๆ") — stacked bars, same 12-week window and
          scale as the overall chart above so the two read side by side. */}
      <Card title="Lead เข้าใหม่รายสัปดาห์ แยกตามช่องทาง">
        {!d ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : d.weeklyBySource.weeks.length === 0 ? <p className="text-sm text-[var(--text-2)]">ไม่มีข้อมูล</p> : (
          <>
            <div className="flex items-end gap-2 h-32">
              {d.weeklyBySource.weeks.map((w) => {
                const total = d.weeklyBySource.categories.reduce((s, c) => s + (w.counts[c] ?? 0), 0);
                const title = [`Week: ${fmtWeekDMY(w.week)} — ${total} ราย`,
                  ...d.weeklyBySource.categories.filter((c) => w.counts[c]).map((c) => `${CAT_TH[c] ?? c}: ${w.counts[c]}`)].join("\n");
                return (
                  <div key={w.week} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={title}>
                    <span className="text-[.78rem] num font-medium text-[var(--text-2)]">{total}</span>
                    <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${(total / maxWeek) * 80}px`, minHeight: total ? 3 : 0 }}>
                      {d.weeklyBySource.categories.map((c) => {
                        const n = w.counts[c] ?? 0;
                        if (!n) return null;
                        return <div key={c} style={{ height: `${(n / (total || 1)) * 100}%`, background: SOURCE_COLOR[c] ?? "#9B968A" }} />;
                      })}
                    </div>
                    <span className="text-[.68rem] num text-[var(--text-3)] whitespace-nowrap">{fmtWeekDMY(w.week)}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-3 border-t border-[var(--border)]">
              {d.weeklyBySource.categories.map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-[.7rem] text-[var(--text-2)]">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SOURCE_COLOR[c] ?? "#9B968A" }} />
                  {CAT_TH[c] ?? c}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>

      {d && (
        <div className="grid lg:grid-cols-2 gap-5">
          <AggTable title="ตามขั้นตอน (funnel)" rows={d.byStage} labelMap={STAGE_TH} />
          <AggTable title="ตามช่องทางที่มา" rows={d.bySource} labelMap={CAT_TH} />
          <AggTable title="ตามแบรนด์" rows={d.byBrand} />
          <AggTable title="ตามเซลส์" rows={d.byOwner} />
        </div>
      )}
    </div>
  );
}
