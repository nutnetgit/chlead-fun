"use client";

// Branch UI (user req 2026-09-09 — "ทำแบบที่ทำไปแล้วใน CPT"): the same
// three pieces the Insurance/CPT app uses instead of an SPS-style "login
// into a branch":
//   · BranchSwitcher — header pill "🏢 สาขา X": the branch the user is
//                     currently WORKING AS (cookie, src/lib/activeBranch.ts);
//                     click to switch among the branches they may use. New
//                     leads/events default to it. Single branch = plain pill.
//   · BranchPicker  — per-page "ทุกสาขา (N)" + list of the branches the user
//                     can see; hidden entirely when there's only one. This is
//                     the data FILTER — independent of the working branch,
//                     exactly CPT's split.
//   · useBranchFilter — the filter lives in the URL (?branch=) so a link can
//                     be shared; the server re-validates the requested branch
//                     against the caller's scope (requestedBranchScope in
//                     src/lib/authz.ts) and rejects anything outside it.

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Building2, Check, ChevronDown, Loader2 } from "lucide-react";
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

export function BranchSwitcher({ me, onSwitched }: { me: Me; onSwitched?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const u = me.user;
  if (!u) return null;
  const branches = u.branches ?? [];
  const active = branches.find((b) => b.branchId === u.activeBranchId) ?? null;
  const label = active ? `สาขา ${active.branchName}` : "ยังไม่ผูกสาขา";
  const pill = "inline-flex items-center gap-1.5 text-[.72rem] px-2.5 py-1 rounded-full bg-[var(--surface)] border border-[var(--border)] text-[var(--text-2)] max-w-[15rem]";

  if (branches.length <= 1) {
    return <span title="สาขาที่กำลังทำงาน" className={`hidden sm:inline-flex ${pill}`}><Building2 size={11} className="shrink-0 text-[var(--text-3)]" /><span className="truncate">{label}</span></span>;
  }

  const pick = async (branchId: number) => {
    if (branchId === u.activeBranchId) { setOpen(false); return; }
    setPending(true); setError(null);
    const res = await fetch("/api/me/branch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId }) });
    setPending(false);
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "สลับสาขาไม่สำเร็จ"); return; }
    setOpen(false);
    onSwitched?.();
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={pending}
        title="สลับสาขาที่ทำงาน — Lead/Event ใหม่จะขึ้นสาขานี้เป็นค่าตั้งต้น"
        className={`${pill} hover:border-[var(--text-3)] transition disabled:opacity-60`}>
        {pending ? <Loader2 size={11} className="animate-spin" /> : <Building2 size={11} className="shrink-0 text-[var(--text-3)]" />}
        <span className="truncate">{pending ? "กำลังสลับ…" : label}</span>
        <ChevronDown size={11} className={`shrink-0 text-[var(--text-3)] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-40 w-64 max-h-80 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[14px] shadow-[var(--shadow)] p-1.5">
          <div className="px-2.5 pt-1 pb-1 text-[10px] text-[var(--text-3)]">สลับสาขาที่ทำงาน (ค่าตั้งต้นของ Lead/Event ใหม่)</div>
          {branches.map((b) => {
            const on = b.branchId === u.activeBranchId;
            return (
              <button key={b.branchId} type="button" onClick={() => pick(b.branchId)}
                className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[.8rem] hover:bg-[var(--surface-2)] ${on ? "font-semibold text-[var(--accent-text)]" : "text-[var(--text-2)]"}`}>
                <span className="truncate">{b.branchName}{b.brandName ? <span className="text-[var(--text-3)] font-normal"> · {b.brandName}</span> : null}</span>
                {on && <Check size={13} className="shrink-0" />}
              </button>
            );
          })}
          {error && <div className="px-2.5 py-1 text-[10px] text-[var(--red)]">{error}</div>}
        </div>
      )}
    </div>
  );
}
