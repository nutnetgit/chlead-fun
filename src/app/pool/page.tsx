"use client";

// Lead pool (handoff §5/§6 governance): unclaimed leads from forfeit/manual
// reassign, hot-first. A manager (or the salesperson themself) picks who
// claims each one — pool claiming needs a person-picker, which a LINE Flex
// button tap can't offer, hence this small web page.

import { useEffect, useState } from "react";
import { Loader2, Flame, Snowflake, Sun } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { fmtDateTime } from "@/lib/date";
import { useMe } from "@/components/Chrome";

type PoolRow = {
  poolId: number; leadId: number; enteredAt: string; enteredReason: string; priority: number;
  customerName: string | null; brandId: number | null; brand: string | null; branch: string | null;
  temperature: string | null; modelInterest: string | null;
};
type UserRow = { userId: number; displayName: string; nickname: string | null; role: string; branchId: number | null; branchIds: number[] };
type BranchRow = { branchId: number; brandId: number | null };

const TEMP_ICON: Record<string, React.ReactNode> = {
  hot: <Flame size={13} className="text-red-600" />,
  warm: <Sun size={13} className="text-amber-600" />,
  cold: <Snowflake size={13} className="text-blue-500" />,
};

export default function PoolPage() {
  const me = useMe();
  const [rows, setRows] = useState<PoolRow[] | null>(null);
  const [allUsers, setAllUsers] = useState<UserRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [claiming, setClaiming] = useState<number | null>(null);

  const load = () => {
    fetch("/api/pool").then((r) => r.json()).then(setRows);
    fetch("/api/users").then((r) => r.json()).then((u: UserRow[]) => setAllUsers(u));
    fetch("/api/branches").then((r) => r.json()).then((d) => setBranches(d.branches ?? []));
  };
  useEffect(() => { load(); }, []);

  const users = allUsers.filter((u) => u.role === "sales");
  const role = me?.user?.role;
  const myFunUserId = me?.user?.funUserId;
  // Looked up from the FULL roster (not the sales-only `users`) — a manager
  // viewing this page isn't in the sales list, so their own branch links
  // would never resolve otherwise, silently breaking their branch scoping.
  const self = allUsers.find((u) => u.userId === myFunUserId);
  const myOwnBranchIds = new Set([...(self?.branchIds ?? []), ...(self?.branchId ? [self.branchId] : [])]);

  // Per-row candidate scoping (user req 2026-07-14: the dropdown showed
  // every salesperson in the company regardless of that lead's brand — a
  // sales viewer must only ever assign to THEMSELVES; a manager may assign
  // to any salesperson who actually sells that lead's brand, further
  // narrowed to their own branches (never company-wide).
  const eligibleFor = (r: PoolRow): UserRow[] => {
    if (role === "sales") return myFunUserId ? users.filter((u) => u.userId === myFunUserId) : [];
    if (r.brandId === null) return users;
    const brandBranchIds = new Set(branches.filter((b) => b.brandId === r.brandId).map((b) => b.branchId));
    const scopedBranchIds = role === "manager" && myOwnBranchIds.size
      ? new Set([...brandBranchIds].filter((bid) => myOwnBranchIds.has(bid)))
      : brandBranchIds;
    return users.filter((u) => {
      const ids = new Set([...(u.branchIds ?? []), ...(u.branchId ? [u.branchId] : [])]);
      return [...ids].some((bid) => scopedBranchIds.has(bid));
    });
  };

  // Sales has exactly one valid choice (themself) — pre-fill it so they can
  // just hit "มอบหมาย" without opening a single-option dropdown.
  useEffect(() => {
    if (role !== "sales" || !rows || !myFunUserId) return;
    setPicked((p) => {
      const next = { ...p };
      for (const r of rows) if (!next[r.poolId]) next[r.poolId] = String(myFunUserId);
      return next;
    });
  }, [role, rows, myFunUserId]);

  async function claim(poolId: number) {
    const userId = Number(picked[poolId]);
    if (!userId) return;
    setClaiming(poolId);
    await fetch(`/api/pool/${poolId}/claim`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
    });
    setClaiming(null);
    load();
  }

  return (
    <div className="space-y-4">
      <Card
        title="Lead Pool — รอแจกต่อ"
        desc="Lead ที่ถูกริบ (หลุด SLA) หรือผจก. สั่งย้าย — เรียงตาม temperature ก่อน (hot มาก่อน) แล้วตามเวลาเข้า pool"
      >
        {rows === null ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">ไม่มี Lead ใน pool ตอนนี้ 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <th className="py-2 pr-3">Lead</th>
                  <th className="py-2 pr-3">แบรนด์/สาขา</th>
                  <th className="py-2 pr-3">เหตุผลเข้า pool</th>
                  <th className="py-2 pr-3">เข้าเมื่อ</th>
                  <th className="py-2 pr-3">มอบให้เซลส์</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const candidates = eligibleFor(r);
                  return (
                  <tr key={r.poolId} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5 font-medium">
                        {r.temperature && TEMP_ICON[r.temperature]}
                        #{r.leadId} {r.customerName || "ไม่ระบุชื่อ"}
                      </div>
                      {r.modelInterest && <div className="text-[11px] text-[var(--muted-foreground)]">{r.modelInterest}</div>}
                    </td>
                    <td className="py-2 pr-3">{r.brand} · {r.branch}</td>
                    <td className="py-2 pr-3 text-[11px] text-[var(--muted-foreground)]">{r.enteredReason}</td>
                    <td className="py-2 pr-3 text-[11px] text-[var(--muted-foreground)]">
                      {fmtDateTime(r.enteredAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <select
                        value={picked[r.poolId] ?? ""}
                        onChange={(e) => setPicked({ ...picked, [r.poolId]: e.target.value })}
                        disabled={role === "sales"}
                        className={inputCls + " max-w-[10rem]" + (role === "sales" ? " opacity-70" : "")}
                      >
                        <option value="">เลือกเซลส์...</option>
                        {candidates.map((u) => <option key={u.userId} value={u.userId}>{u.nickname || u.displayName}</option>)}
                      </select>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => claim(r.poolId)}
                        disabled={!picked[r.poolId] || claiming === r.poolId}
                        className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
                      >
                        {claiming === r.poolId ? <Loader2 size={13} className="animate-spin" /> : null}
                        มอบหมาย
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
