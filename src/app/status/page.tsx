"use client";
import { fmtDateTime } from "@/lib/date";

// Connection status (handoff §5.2): FB token health, LINE bot alive, Sheets
// service-account access. n8n runs the actual checks (weekly /debug_token etc.)
// and writes snapshots into fun_settings — this page only displays them.

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui";
import type { HealthStatus } from "@/lib/types";
import { SettingsShell } from "@/components/SettingsShell";

const CHECKS: { key: string; label: string; desc: string }[] = [
  { key: "fb_token_health", label: "Facebook System User token", desc: "n8n เรียก /debug_token ทุกสัปดาห์แล้วบันทึกผลไว้ที่นี่" },
  { key: "line_bot_health", label: "LINE Bot (CEA Sales Assistant)", desc: "สถานะ Messaging API ของ OA" },
  { key: "sheets_health", label: "Google Sheets service account", desc: "สิทธิ์เข้าถึง spreadsheet ปลายทาง" },
];

export default function StatusPage() {
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);

  const load = () => fetch("/api/settings").then(r => r.json()).then(setSettings);
  useEffect(() => { load(); }, []);

  const render = (key: string) => {
    const h = settings?.[key] as HealthStatus | undefined;
    if (!h) {
      return (
        <span className="flex items-center gap-1.5 text-[var(--muted-foreground)] text-xs">
          <HelpCircle size={14} /> ยังไม่มีข้อมูล (รอ n8n เขียนผลตรวจ)
        </span>
      );
    }
    return (
      <div className="text-xs">
        <span className={"flex items-center gap-1.5 font-medium " + (h.ok ? "text-green-700" : "text-red-600")}>
          {h.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {h.ok ? "ปกติ" : "มีปัญหา"}
        </span>
        {h.detail && <p className="mt-0.5 text-[var(--muted-foreground)]">{h.detail}</p>}
        {h.checkedAt && (
          <p className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">
            ตรวจล่าสุด: {fmtDateTime(h.checkedAt)}
          </p>
        )}
      </div>
    );
  };

  return (
    <SettingsShell>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-semibold">Connection Status</h1>
        <button onClick={load}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] bg-white hover:bg-[var(--accent)]">
          <RefreshCw size={11} /> รีเฟรช
        </button>
      </div>
      {CHECKS.map(c => (
        <Card key={c.key} title={c.label} desc={c.desc}>
          {settings === null ? <p className="text-xs text-[var(--muted-foreground)]">Loading…</p> : render(c.key)}
        </Card>
      ))}
    </div>
    </SettingsShell>
  );
}
