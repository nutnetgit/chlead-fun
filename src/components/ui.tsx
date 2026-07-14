"use client";

// Shared UI primitives — same look as CATS Settings (handoff §0.3: reuse the
// CATS settings UX so Ch.Lead FUN feels familiar).

import { cn } from "@/lib/utils";
import { Check, Loader2, Info } from "lucide-react";

export const inputCls =
  "w-full px-3 py-2 text-sm bg-white border border-[var(--border)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--primary)]";

export function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-[var(--border)] p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
        {desc && <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export function SaveButton({
  onClick,
  state,
  label = "บันทึก",
}: {
  onClick: () => void;
  state: "idle" | "saving" | "saved";
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={state === "saving"}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
        state === "saved" ? "bg-green-600 text-white" : "bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50"
      )}
    >
      {state === "saved" ? <><Check size={14} /> บันทึกแล้ว</> : state === "saving" ? <><Loader2 size={14} className="animate-spin" /> กำลังบันทึก…</> : label}
    </button>
  );
}

// Hover/focus explainer (user req 2026-07-14: Dashboard's always-visible
// explainer paragraphs under every section header made the page look
// cluttered) — swaps a wordy <p> for a small icon; the text is still there,
// just on-demand instead of permanently taking vertical space. Native
// `title` attribute — no extra JS state, works with keyboard focus too.
export function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} tabIndex={0}
      className="inline-flex items-center justify-center text-[var(--text-3)] hover:text-[var(--text-2)] cursor-help shrink-0 outline-none">
      <Info size={13} />
    </span>
  );
}

export function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-40",
        on ? "bg-[var(--primary)]" : "bg-[var(--border)]"
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform",
          on && "translate-x-4"
        )}
      />
    </button>
  );
}
