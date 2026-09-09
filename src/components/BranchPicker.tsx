"use client";

// Branch picker (user req 2026-09-09 — "ทำแบบที่ทำไปแล้วใน CPT"): the same
// three pieces the Insurance/CPT app uses instead of an SPS-style "login
// into a branch" switch:
//   · BranchBadge   — header chip: the user's home branch, or "ทุกสาขา"
//   · BranchPicker  — per-page "ทุกสาขา (N)" + list of the branches the user
//                     can see; hidden entirely when there's only one
//   · useBranchFilter — the selection lives in the URL (?branch=) so a link
//                     can be shared/bookmarked; the server re-validates the
//                     requested branch against the caller's scope
//                     (requestedBranchScope in src/lib/authz.ts) and rejects
//                     anything outside it, never silently falls back.

import { useCallback, useState } from "react";
import { MapPin } from "lucide-react";
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
  const home = u.branches?.find((b) => b.branchId === u.branchId);
  const text = home ? home.branchName : (u.branches?.length ?? 0) > 1 ? `ทุกสาขา (${u.branches!.length})` : u.branches?.[0]?.branchName ?? "ทุกสาขา";
  return (
    <span title={`สาขาประจำ: ${home?.branchName ?? "—"} · เห็นได้ ${u.branches?.length ?? 0} สาขา`}
      className="hidden sm:inline-flex items-center gap-1 text-[.7rem] px-2.5 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] max-w-[14rem] truncate">
      <MapPin size={11} className="shrink-0 text-[var(--text-3)]" /> {text}
    </span>
  );
}
