"use client";

// Run Rate v2 — count-based, month-by-month with carry-over. Salespeople see
// their own numbers; managers see the team and set targets (team + per-sales).

import { useEffect, useState, useCallback } from "react";
import { Loader2, TrendingUp, AlertTriangle } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { useMe } from "@/components/Chrome";

type Data = {
  scope: string;
  brandId: number | null;
  leadTarget: { leadsPerBooking: number; fromBooking: number | null; fromEvents: number; total: number | null };
  config: { target: number | null; perUser: Record<string, number> };
  month: { name: number; daysElapsed: number; daysLeft: number; daysInMonth: number; actualBookings: number; target: number | null; carryIn: number; neededThisMonth: number | null };
  leads: { toDate: number; projected: number; expectedRest: number };
  conversion: { windowDays: number; cohortLeads: number; cohortConverted: number; rate: number };
  weightedPipeline: {
    hot: { count: number; probabilityPct: number; expected: number };
    warm: { count: number; probabilityPct: number; expected: number };
    cold: { count: number; probabilityPct: number; expected: number };
    total: number;
  };
  forecast: { projectedBookings: number };
  monthsTable: { month: number; actual: number; target: number | null; carry: number | null }[];
  note: string;
};
type UserRow = { userId: number; displayName: string; role: string; branchId: number | null; branchIds: number[] };
type BrandRow = { brandId: number; brandName: string };
type BranchRow = { branchId: number; brandId: number | null };

const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function RunRatePage() {
  const me = useMe();
  const isSales = me?.user?.role === "sales";
  const [d, setD] = useState<Data | null>(null);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [brandFilter, setBrandFilter] = useState<number | null>(null);
  const [perUser, setPerUser] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (isSales && me?.user) params.set("owner", String(me.user.funUserId));
    if (brandFilter !== null) params.set("brandId", String(brandFilter));
    const q = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/runrate${q}`).then((r) => r.json()).then((data: Data) => {
      setD(data);
      // Server always returns the FULL perUser map regardless of brandId
      // filter (targets are keyed brandId:userId already) — no client-side
      // re-keying needed.
      setPerUser(Object.fromEntries(Object.entries(data.config.perUser).map(([k, v]) => [k, String(v)])));
    });
  }, [isSales, me, brandFilter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then((us: UserRow[]) => setAllUsers(us));
    fetch("/api/branches").then((r) => r.json()).then((data) => { setBrands(data.brands ?? []); setBranches(data.branches ?? []); });
  }, []);

  const role = me?.user?.role;
  const self = allUsers.find((u) => u.userId === me?.user?.funUserId);
  const myOwnBranchIds = new Set([...(self?.branchIds ?? []), ...(self?.branchId ? [self.branchId] : [])]);

  // Brand chips (user req 2026-07-14: multi-brand ผจก./เซลส์ need separated
  // and combined views): scoped to the brands of the viewer's own branches —
  // admin/gm see every brand; single-brand users get no chip bar at all.
  const myBrands = (() => {
    if (!role) return [];
    if (role === "admin" || role === "gm") return brands;
    if (!myOwnBranchIds.size) return brands;
    const brandIds = new Set(branches.filter((b) => myOwnBranchIds.has(b.branchId)).map((b) => b.brandId).filter((x): x is number => x !== null));
    return brands.filter((b) => brandIds.has(b.brandId));
  })();

  // No "รวมทุกยี่ห้อ" combined view (user req 2026-07-14, removed after the
  // per-brand target rework): every number on this page, including the read
  // side, is now always scoped to exactly one brand — auto-picks the first
  // brand the viewer can see once the brand list loads, so brandFilter is
  // only ever null for the brief instant before that fetch resolves.
  useEffect(() => {
    if (brandFilter === null && myBrands.length > 0) setBrandFilter(myBrands[0].brandId);
  }, [brandFilter, myBrands]);

  // Per-brand booking-target editing (bug fixed 2026-07-14: a single flat
  // target per user was ambiguous for anyone selling >1 brand — editing it
  // under one brand's view silently overwrote the OTHER brand's real
  // number). Editing now REQUIRES an unambiguous brand: either the viewer
  // picked one via the chips above, or they only have exactly one brand to
  // begin with (no chip bar shown at all in that case).
  const editBrandId = brandFilter ?? (myBrands.length === 1 ? myBrands[0].brandId : null);

  // Candidates for that brand: sales/manager users whose branch access
  // includes a branch of editBrandId — further narrowed to the viewer's OWN
  // branches when they're a manager (never company-wide, per user req:
  // "filter ตั้งแต่แรกตามยี่ห้อ หรือตามสาขา ... ไม่มีการเอามารวมกันของทุกยี่ห้อ").
  const eligibleForEdit = (() => {
    if (editBrandId === null) return [];
    const brandBranchIds = new Set(branches.filter((b) => b.brandId === editBrandId).map((b) => b.branchId));
    const scopedBranchIds = role === "manager" && myOwnBranchIds.size
      ? new Set([...brandBranchIds].filter((bid) => myOwnBranchIds.has(bid)))
      : brandBranchIds;
    return allUsers.filter((u) => {
      if (u.role !== "sales" && u.role !== "manager") return false;
      const ids = new Set([...(u.branchIds ?? []), ...(u.branchId ? [u.branchId] : [])]);
      return [...ids].some((bid) => scopedBranchIds.has(bid));
    });
  })();

  async function saveConfig() {
    if (editBrandId === null) return;
    setSaving(true);
    const payload = Object.fromEntries(
      Object.entries(perUser)
        .filter(([k, v]) => k.startsWith(`${editBrandId}:`) && v && Number(v) > 0)
        .map(([k, v]) => [k, Number(v)]),
    );
    // Explicitly clear any entry for an eligible user left blank (so
    // removing a number in the box actually deletes the target, not just
    // skips sending it).
    for (const u of eligibleForEdit) {
      const key = `${editBrandId}:${u.userId}`;
      if (!(key in payload) && !perUser[key]) payload[key] = 0;
    }
    await fetch("/api/runrate", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perUser: payload }),
    });
    setSaving(false); load();
  }

  if (!d) return <p className="text-sm text-[var(--text-2)]">Loading…</p>;
  const m = d.month;
  const hasTarget = m.target !== null;
  const done = m.neededThisMonth === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.7rem]">Run Rate เป้าเดือน {TH_M[m.name - 1]}</h1>
        <p className="text-[var(--text-2)] text-[.95rem]">นับจำนวนจอง (จองได้ = จบเคส) · เกินเป้าเดือนนี้ยกไปเดือนหน้า · เหลืออีก {m.daysLeft} วัน</p>
      </div>

      {myBrands.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium text-[var(--text-3)]">ยี่ห้อ</span>
          {myBrands.map((b) => (
            <button key={b.brandId} onClick={() => setBrandFilter(b.brandId)}
              className={`text-[.76rem] px-3 py-1 rounded-full border transition ${
                brandFilter === b.brandId ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                                          : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
              {b.brandName}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: `จองแล้วเดือนนี้${hasTarget ? ` / เป้า ${m.target}` : ""}`, v: `${m.actualBookings}${hasTarget ? ` / ${m.target}` : ""}`, cls: done ? "text-[var(--green)]" : "" },
          { l: "ยอดยกมา (สะสมทั้งปี)", v: m.carryIn > 0 ? `+${m.carryIn}` : String(m.carryIn), cls: m.carryIn >= 0 ? "text-[var(--green)]" : "text-[var(--red)]" },
          { l: "ต้องจองอีกในเดือนนี้", v: m.neededThisMonth ?? "—", cls: done ? "text-[var(--green)]" : "text-[var(--accent-text)]" },
          { l: `Conversion (${d.conversion.cohortConverted}/${d.conversion.cohortLeads})`, v: pct(d.conversion.rate), cls: "" },
        ].map((c) => (
          <div key={c.l} className="bg-white border border-[var(--border)] rounded-xl px-4 py-3 shadow-[var(--shadow)]">
            <div className="text-[.7rem] text-[var(--text-2)]">{c.l}</div>
            <div className={`text-xl font-semibold num mt-0.5 ${c.cls}`}>{c.v}</div>
          </div>
        ))}
      </div>

      {hasTarget && m.neededThisMonth !== null && (
        <div className={`rounded-2xl border p-5 ${done ? "bg-[var(--green-soft)] border-[var(--green)]" : "bg-[var(--accent-soft)] border-[var(--primary)]"}`}>
          {done ? (
            <div className="flex items-center gap-2 font-medium text-[.95rem]">
              <TrendingUp size={18} className="text-[var(--green)]" /> ถึงเป้าเดือนนี้แล้ว 🎉 — ที่จองเพิ่มจากนี้ยกไปเดือน {TH_M[m.name % 12]}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 font-medium text-[.95rem]">
                <AlertTriangle size={18} className="text-[var(--accent-text)]" />
                ต้องจองอีก <b className="num">{m.neededThisMonth} เคส</b> ใน {m.daysLeft} วันที่เหลือ
              </div>
              {d.forecast && (
                <div className="mt-3 grid md:grid-cols-3 gap-2 text-[.82rem]">
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-[.7rem] text-[var(--text-3)]">Lead ที่ต้องใช้ (ที่ CR {pct(d.conversion.rate)})</div>
                    <b className="num text-lg">{d.conversion.rate > 0 ? Math.ceil(m.neededThisMonth / d.conversion.rate) : "—"} ราย</b>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-[.7rem] text-[var(--text-3)]">Lead ที่คาดว่าจะเข้าเองช่วงที่เหลือ</div>
                    <b className="num text-lg">{d.leads.expectedRest} ราย</b>
                  </div>
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-[.7rem] text-[var(--text-3)]">🔍 ต้องหา Lead เพิ่มอีก</div>
                    <b className={`num text-lg ${d.conversion.rate > 0 && Math.max(0, Math.ceil(m.neededThisMonth / d.conversion.rate) - d.leads.expectedRest) > 0 ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
                      {d.conversion.rate > 0 ? Math.max(0, Math.ceil(m.neededThisMonth / d.conversion.rate) - d.leads.expectedRest) : "—"} ราย
                    </b>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {d.leadTarget.total !== null && (
        <Card title="เป้า Lead เดือนนี้ (คำนวณอัตโนมัติ)" desc="เป้าจอง × ตัวคูณ Lead ต่อ 1 จอง (ตั้งค่าที่ Conversion Rate) + เป้า Lead จาก Event ที่คาบเกี่ยวเดือนนี้ (event คร่อมเดือนแบ่งเป้าตามสัดส่วนวัน)">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-[.7rem] text-[var(--text-3)]">จากเป้าจอง{d.leadTarget.fromBooking !== null ? ` (${m.target} × ${d.leadTarget.leadsPerBooking})` : ""}</div>
              <div className="text-lg font-semibold num mt-0.5">{d.leadTarget.fromBooking ?? "—"}</div>
            </div>
            <div className="bg-white border border-[var(--border)] rounded-xl px-3 py-2.5">
              <div className="text-[.7rem] text-[var(--text-3)]">จาก Event เดือนนี้</div>
              <div className="text-lg font-semibold num mt-0.5">{d.leadTarget.fromEvents}</div>
            </div>
            <div className="bg-[var(--accent-soft)] border border-[var(--primary)] rounded-xl px-3 py-2.5">
              <div className="text-[.7rem] text-[var(--accent-text)]">รวมเป้า Lead เดือนนี้</div>
              <div className="text-lg font-bold num mt-0.5 text-[var(--accent-text)]">{d.leadTarget.total} ราย</div>
            </div>
          </div>
          <div className="text-[.76rem] text-[var(--text-2)]">
            เทียบของจริง: Lead เข้าแล้ว <b className="num">{d.leads.toDate}</b> ราย · คาดทั้งเดือน <b className="num">{d.leads.projected}</b> ราย
          </div>
        </Card>
      )}

      <Card title="Weighted Pipeline (พยากรณ์จาก Lead ที่เปิดอยู่)" desc="Lead ที่ active ตอนนี้ × โอกาสปิดของแต่ละระดับ (ตั้งค่าได้ที่ /settings/conversion-rates)">
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: "hot", label: "HOT", cls: "text-[var(--red)]" },
            { key: "warm", label: "WARM", cls: "text-[var(--amber)]" },
            { key: "cold", label: "COLD", cls: "text-[var(--text-2)]" },
          ] as const).map((t) => {
            const tier = d.weightedPipeline[t.key];
            return (
              <div key={t.key} className="bg-white border border-[var(--border)] rounded-xl px-3 py-2.5">
                <div className={`text-[.72rem] font-semibold ${t.cls}`}>{t.label}</div>
                <div className="text-[.78rem] text-[var(--text-2)] mt-0.5">{tier.count} ราย × {tier.probabilityPct}%</div>
                <div className="text-lg font-semibold num mt-0.5">{tier.expected}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--accent-soft)] px-4 py-3">
          <span className="text-[.85rem] font-medium">รวมคาดว่าจะจองได้</span>
          <b className="num text-xl text-[var(--accent-text)]">{d.weightedPipeline.total} เคส</b>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="รายเดือนปีนี้ (ยอดสะสม + ยกยอด)">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
                <th className="py-2">เดือน</th><th className="py-2 text-right">จองได้</th>
                <th className="py-2 text-right">เป้า</th><th className="py-2 text-right">ยกยอดสะสม</th>
              </tr>
            </thead>
            <tbody>
              {d.monthsTable.map((r) => (
                <tr key={r.month} className={`border-b border-[var(--border)] last:border-0 ${r.month === m.name ? "bg-[var(--accent-soft)]" : ""}`}>
                  <td className="py-2">{TH_M[r.month - 1]}{r.month === m.name ? " (เดือนนี้)" : ""}</td>
                  <td className="py-2 text-right num font-medium">{r.actual}</td>
                  <td className="py-2 text-right num text-[var(--text-2)]">{r.target ?? "—"}</td>
                  <td className={`py-2 text-right num font-medium ${r.carry === null ? "" : r.carry >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                    {r.carry === null ? "—" : r.carry > 0 ? `+${r.carry}` : r.carry}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[var(--text-3)]">{d.note}</p>
        </Card>

        {!isSales && (
          <Card title="ตั้งเป้าจอง (ผจก.)" desc="ตัวเลขทุกช่องในการ์ดนี้คือจำนวน 'เคสจอง' ต่อเดือน ต่อยี่ห้อ — เป้า Lead ไม่ต้องกรอก ระบบคูณให้อัตโนมัติจากตัวคูณในหน้า Conversion Rate (การ์ดเป้า Lead ด้านบน)">
            {editBrandId === null ? (
              <p className="text-[.82rem] text-[var(--text-2)] bg-[var(--bg)] rounded-xl px-3.5 py-3">
                เลือกยี่ห้อจาก chip ด้านบนก่อน ถึงจะตั้งเป้ารายเซลส์ได้ — เซลส์บางคนขายได้หลายยี่ห้อ เป้าจองของแต่ละยี่ห้อจึงต้องแยกกันชัดเจน ไม่ปนกัน
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl bg-[var(--accent-soft)] px-4 py-3">
                  <span className="text-[.82rem] font-medium text-[var(--accent-text)]">
                    เป้าทีม{brandFilter !== null ? ` (${brands.find((b) => b.brandId === editBrandId)?.brandName ?? ""})` : ""} — รวมจากเป้ารายเซลส์ด้านล่าง
                  </span>
                  <b className="num text-xl text-[var(--accent-text)]">{d.month.target ?? 0} เคส</b>
                </div>
                <div>
                  <span className="text-[11px] font-medium text-[var(--text-2)] mb-2 block">เป้าจองรายเซลส์ (เคสจอง/เดือน)</span>
                  {eligibleForEdit.length === 0 ? (
                    <p className="text-[.76rem] text-[var(--text-3)]">ไม่มีเซลส์ที่ขายยี่ห้อนี้ในสาขาของคุณ</p>
                  ) : (
                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-2">
                      {eligibleForEdit.map((u) => {
                        const key = `${editBrandId}:${u.userId}`;
                        return (
                          <label key={u.userId} className="flex items-center gap-2 text-[.8rem]">
                            <span className="flex-1 truncate">{u.displayName}</span>
                            <input type="number" min={0} value={perUser[key] ?? ""}
                              onChange={(e) => setPerUser((p) => ({ ...p, [key]: e.target.value }))}
                              className="w-20 px-2 py-1 text-sm bg-white border border-[var(--border-2)] rounded-lg text-right" placeholder="—" />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button onClick={saveConfig} disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-95 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null} บันทึกเป้าจอง
                </button>
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
