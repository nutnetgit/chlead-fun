"use client";

// Branch UI. Two pieces, deliberately NOT three (user req 2026-09-09, after
// the CPT-parity switcher turned out to be redundant here):
//   · BranchBadge   — header pill "🏢 สาขา X", read-only. Lead FUN already
//                     splits every list by brand chips, and a branch row is
//                     brand × location, so a header dropdown would have been
//                     a second, silent way to say the same thing — and worse,
//                     switching it did NOT change any list, which is a trap.
//                     The working branch still exists server-side (cookie,
//                     src/lib/activeBranch.ts, POST /api/me/branch) so SPS /
//                     future callers can read it; nothing in the UI sets it.
//   · BranchPicker  — per-page "ทุกสาขา (N)" + the branches the user can see;
//                     hidden when there's only one. This is the ONE branch
//                     control: it filters data.
//   · useBranchFilter — the filter lives in the URL (?branch=) so a link can
//                     be shared; the server re-validates the requested branch
//                     against the caller's scope (requestedBranchScope in
//                     src/lib/authz.ts) and rejects anything outside it.

import { useCallback, useState } from "react";
import { MapPin, Building2 } from "lucide-react";
import { useMe, type Me } from "@/components/Chrome";

export function useBranchFilter(): [string, (v: string) => void] {
  const [branch, setState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("branch") ?? "";
  });
  const setBranch = useCallback((v: string) => {
    setState(v);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (v) url.searchParams.set("branch", v); else url.searchParams.delete("branch");
    window.history.replaceState(null, "", url.toString());
  }, []);
  return [branch, setBranch];
}

export function BranchPicker({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  const me = useMe();
  const branches = me?.user?.branches ?? [];
  if (branches.length <= 1) return null;
  return (
    <label className={`inline-flex items-center gap-1.5 text-[.76rem] ${className}`}>
      <MapPin size={12} className="text-[var(--text-3)]" />
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="text-[.76rem] border border-[var(--border-2)] rounded-full px-2.5 py-1 bg-white text-[var(--text-2)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]">
        <option value="">ทุกสาขา ({branches.length})</option>
        {branches.map((b) => (
          <option key={b.branchId} value={b.branchId}>{b.branchName}{b.brandName ? ` · ${b.brandName}` : ""}</option>
        ))}
      </select>
    </label>
  );
}

export function BranchBadge({ me }: { me: Me }) {
  const u = me.user;
  if (!u) return null;
  const branches = u.branches ?? [];
  const active = branches.find((b) => b.branchId === u.activeBranchId) ?? null;
  const label = active ? `สาขา ${active.branchName}` : "ยังไม่ผูกสาขา";
  return (
    <span title="สาขาที่สังกัด — ใช้เป็นค่าตั้งต้นของ Lead ใหม่ · กรองข้อมูลข้ามสาขาได้ที่ตัวเลือก “ทุกสาขา” ในแต่ละหน้า"
      className="hidden sm:inline-flex items-center gap-1.5 text-[.72rem] px-2.5 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] max-w-[15rem]">
      <Building2 size={11} className="shrink-0 text-[var(--text-3)]" />
      <span className="truncate">{label}</span>
    </span>
  );
}
