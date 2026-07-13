"use client";

// Deep-link landing page for the SLA-escalate card's "ยกเว้น" button (handoff
// §5 — exemption always requires a written reason, always logged as an
// sla_override activity, never a silent tap). Opened from the LINE message
// the manager receives after tapping "ยกเว้น" (see lib/governance.ts).
//
// The acting manager is the signed-in session (user req 2026-07-08) — this
// page already sits behind middleware.ts's login gate, so there's no need to
// ask "who are you" via a picker; the API derives it from the session itself.

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Card, inputCls } from "@/components/ui";
import { useMe } from "@/components/Chrome";

type LeadInfo = {
  leadId: number; customerName: string | null; brand: string; branch: string;
  temperature: string | null; modelInterest: string | null; ownerName: string | null; lastActivityAt: string | null;
};

function ExemptForm() {
  const me = useMe();
  const params = useSearchParams();
  const leadId = params.get("lead");
  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) return;
    fetch(`/api/leads/${leadId}`).then((r) => r.json()).then(setLead);
  }, [leadId]);

  async function submit() {
    if (!reason.trim()) return;
    setState("saving");
    const res = await fetch("/api/governance/exempt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: Number(leadId), reason }),
    });
    const data = await res.json();
    if (res.ok && data.ok) setState("done");
    else { setState("error"); setError(data.error ?? "บันทึกไม่สำเร็จ"); }
  }

  if (!leadId) return <p className="text-sm text-red-600">ไม่พบ Lead ที่ระบุ (ลิงก์ไม่ถูกต้อง)</p>;
  if (state === "done") {
    return (
      <Card title="บันทึกแล้ว">
        <p className="text-sm flex items-center gap-2 text-green-700"><CheckCircle2 size={16} /> ยกเว้น SLA breach ของ Lead #{leadId} เรียบร้อย — บันทึกเหตุผลไว้ในประวัติแล้ว</p>
      </Card>
    );
  }

  return (
    <Card title={`ยกเว้น SLA breach — Lead #${leadId}`} desc="ต้องระบุเหตุผล — บันทึกไว้ถาวรในประวัติ Lead ผจก. เห็น aggregate การยกเว้นรายเซลส์">
      {!lead ? (
        <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-[var(--accent)] p-3 text-sm space-y-1">
            <p><b>{lead.customerName || "ไม่ระบุชื่อ"}</b> — {lead.brand} · {lead.branch}</p>
            {lead.modelInterest && <p className="text-[var(--muted-foreground)]">สนใจ: {lead.modelInterest}</p>}
            <p className="text-[var(--muted-foreground)]">เซลส์: {lead.ownerName ?? "ไม่มีเจ้าของ"}{lead.temperature ? ` · ${lead.temperature.toUpperCase()}` : ""}</p>
          </div>
          <p className="text-[.8rem] text-[var(--text-2)]">ผู้จัดการที่ยืนยัน: <b>{me?.user?.displayName ?? "…"}</b></p>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">เหตุผล *</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}
              placeholder="เช่น ลูกค้าแจ้งเลื่อนนัดเอง, กำลังรอเอกสารไฟแนนซ์..." />
          </label>
          {state === "error" && <p className="text-xs text-red-600">❌ {error}</p>}
          <button onClick={submit} disabled={!reason.trim() || state === "saving"}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {state === "saving" ? <Loader2 size={14} className="animate-spin" /> : null}
            ยืนยันยกเว้น
          </button>
        </div>
      )}
    </Card>
  );
}

export default function ExemptPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted-foreground)]">Loading…</p>}>
      <ExemptForm />
    </Suspense>
  );
}
