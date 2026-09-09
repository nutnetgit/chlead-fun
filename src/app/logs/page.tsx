"use client";

// System log (admin / owner / gm) — two tabs:
//  · ไทม์ไลน์: merged read-only timeline of what the system recorded (stage
//    moves, activities, SLA events, reassignments, Aira drafts)
//  · Audit: fun_audit_log (user req 2026-09-09) — who did what, to which
//    record, when, from where, with what result. Filterable, paged, CSV.

import { useCallback, useEffect, useState } from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtDateTime } from "@/lib/date";
import { SettingsShell } from "@/components/SettingsShell";
import { useMe } from "@/components/Chrome";

type Item = { at: string; kind: string; text: string; by: string | null };

const KIND: Record<string, { label: string; cls: string }> = {
  stage: { label: "สถานะ", cls: "bg-[var(--accent-soft)] text-[var(--accent-text)]" },
  activity: { label: "กิจกรรม", cls: "bg-[var(--surface-2)] text-[var(--text-2)]" },
  sla: { label: "SLA", cls: "bg-[var(--red-soft)] text-[var(--red)]" },
  assign: { label: "เปลี่ยนมือ", cls: "bg-[var(--amber-soft)] text-[var(--amber)]" },
  aira: { label: "ไอรา", cls: "bg-[var(--green-soft)] text-[var(--green)]" },
};

type AuditRow = {
  auditId: number; at: string; actorUserId: number | null; actorName: string | null; actorRole: string | null;
  source: string; action: string; entityType: string | null; entityId: string | null; branchId: number | null;
  ip: string | null; result: string; detail: string | null; before: string | null; after: string | null; requestId: string | null;
};

const ACTION_GROUPS: { label: string; prefix: string }[] = [
  { label: "ทั้งหมด", prefix: "" },
  { label: "เข้า/ออกระบบ", prefix: "auth." },
  { label: "ผู้ใช้และสิทธิ์", prefix: "user." },
  { label: "Lead", prefix: "lead." },
  { label: "ใบเสนอราคา", prefix: "quote." },
  { label: "ตั้งค่า", prefix: "settings." },
  { label: "Export", prefix: "report." },
  { label: "ถูกปฏิเสธ", prefix: "perm." },
  { label: "Webhook", prefix: "webhook." },
];
const RESULT_CLS: Record<string, string> = {
  ok: "bg-[var(--green-soft)] text-[var(--green)]",
  denied: "bg-[var(--red-soft)] text-[var(--red)]",
  error: "bg-[var(--amber-soft)] text-[var(--amber)]",
};

function Timeline() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState("");
  useEffect(() => { fetch("/api/logs").then((r) => r.json()).then(setItems); }, []);
  const filtered = (items ?? []).filter((i) => !kind || i.kind === kind);
  return (
    <>
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setKind("")} className={`text-[.74rem] px-3 py-1 rounded-full border ${!kind ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-medium" : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>ทั้งหมด</button>
        {Object.entries(KIND).map(([k, v]) => (
          <button key={k} onClick={() => setKind(kind === k ? "" : k)}
            className={`text-[.74rem] px-3 py-1 rounded-full border ${kind === k ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-medium" : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>{v.label}</button>
        ))}
      </div>
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
        {items === null ? <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p> :
          filtered.length === 0 ? <p className="p-5 text-sm text-[var(--text-2)]">ไม่มีรายการ</p> :
          filtered.map((i, idx) => (
            <div key={idx} className="px-5 py-2.5 border-b border-[var(--border)] last:border-0 flex items-start gap-3 text-[.82rem]">
              <span className={`text-[.62rem] font-semibold px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${KIND[i.kind]?.cls ?? ""}`}>{KIND[i.kind]?.label ?? i.kind}</span>
              <span className="flex-1">{i.text}{i.by && <span className="text-[var(--text-3)]"> — โดย {i.by}</span>}</span>
              <span className="text-[.68rem] text-[var(--text-3)] num shrink-0">{fmtDateTime(i.at)}</span>
            </div>
          ))}
      </div>
    </>
  );
}

function Audit() {
  const me = useMe();
  const canExport = !!me?.user?.perms?.settings?.report;
  const [prefix, setPrefix] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ total: number; pageSize: number; items: AuditRow[] } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const query = useCallback(() => {
    const p = new URLSearchParams();
    if (prefix) p.set("action", prefix);
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (result) p.set("result", result);
    return p;
  }, [prefix, q, from, to, result]);

  useEffect(() => {
    const p = query(); p.set("page", String(page));
    setData(null);
    fetch(`/api/audit?${p}`).then((r) => r.json()).then(setData).catch(() => setData({ total: 0, pageSize: 50, items: [] }));
  }, [query, page]);
  useEffect(() => { setPage(1); }, [prefix, q, from, to, result]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const inp = "text-[.76rem] border border-[var(--border-2)] rounded-md px-2 py-1 bg-white";

  return (
    <>
      <div className="flex gap-1.5 flex-wrap items-center">
        {ACTION_GROUPS.map((g) => (
          <button key={g.prefix} onClick={() => setPrefix(g.prefix)}
            className={`text-[.74rem] px-3 py-1 rounded-full border ${prefix === g.prefix ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent font-medium" : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>{g.label}</button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นในรายละเอียด…" className={inp + " w-48"} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} />
        <span className="text-[.72rem] text-[var(--text-3)]">ถึง</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} />
        <select value={result} onChange={(e) => setResult(e.target.value)} className={inp}>
          <option value="">ผลทุกแบบ</option><option value="ok">สำเร็จ</option><option value="denied">ถูกปฏิเสธ</option><option value="error">ผิดพลาด</option>
        </select>
        <span className="text-[.72rem] text-[var(--text-3)] ml-auto">{data ? `${data.total.toLocaleString()} รายการ` : "…"}</span>
        {canExport && (
          <a href={`/api/audit?${query()}&format=csv`} className="flex items-center gap-1 text-[.72rem] text-[var(--accent-text)] hover:underline">
            <Download size={12} /> CSV (สูงสุด 5,000)
          </a>
        )}
      </div>
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-x-auto">
        <table className="w-full text-[.78rem]">
          <thead>
            <tr className="text-left text-[10px] text-[var(--text-3)] border-b border-[var(--border)]">
              <th className="py-2 px-3">เวลา</th><th className="py-2 px-3">ผู้ทำ</th><th className="py-2 px-3">การกระทำ</th>
              <th className="py-2 px-3">รายการ</th><th className="py-2 px-3">ผล</th><th className="py-2 px-3">รายละเอียด</th><th className="py-2 px-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {data === null ? <tr><td colSpan={7} className="p-5 text-[var(--text-2)]">Loading…</td></tr> :
             data.items.length === 0 ? <tr><td colSpan={7} className="p-5 text-[var(--text-2)]">ไม่มีรายการ</td></tr> :
             data.items.map((r) => (
              <Fragment key={r.auditId}>
                <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] cursor-pointer" onClick={() => setOpen(open === r.auditId ? null : r.auditId)}>
                  <td className="py-2 px-3 num whitespace-nowrap text-[.7rem] text-[var(--text-3)]">{fmtDateTime(r.at)}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{r.actorName ?? <span className="text-[var(--text-3)]">{r.source}</span>}{r.actorRole && <span className="text-[10px] text-[var(--text-3)]"> · {r.actorRole}</span>}</td>
                  <td className="py-2 px-3 font-mono text-[.7rem]">{r.action}</td>
                  <td className="py-2 px-3 text-[.7rem] text-[var(--text-2)]">{r.entityType ? `${r.entityType} #${r.entityId ?? ""}` : "—"}</td>
                  <td className="py-2 px-3"><span className={`text-[.62rem] font-semibold px-2 py-0.5 rounded-full ${RESULT_CLS[r.result] ?? ""}`}>{r.result}</span></td>
                  <td className="py-2 px-3 max-w-[22rem] truncate" title={r.detail ?? ""}>{r.detail ?? ""}</td>
                  <td className="py-2 px-3 font-mono text-[.68rem] text-[var(--text-3)]">{r.ip ?? ""}</td>
                </tr>
                {open === r.auditId && (r.before || r.after) && (
                  <tr className="bg-[var(--bg)]"><td colSpan={7} className="px-4 py-2">
                    <div className="grid md:grid-cols-2 gap-3 text-[.7rem] font-mono">
                      <div><div className="text-[10px] text-[var(--text-3)] mb-1">ก่อน</div><pre className="whitespace-pre-wrap break-all">{r.before ?? "—"}</pre></div>
                      <div><div className="text-[10px] text-[var(--text-3)] mb-1">หลัง</div><pre className="whitespace-pre-wrap break-all">{r.after ?? "—"}</pre></div>
                    </div>
                    {r.requestId && <div className="text-[10px] text-[var(--text-3)] mt-1 font-mono">req {r.requestId}</div>}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-[.74rem]">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded border border-[var(--border-2)] bg-white disabled:opacity-40"><ChevronLeft size={14} /></button>
        <span className="num">หน้า {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded border border-[var(--border-2)] bg-white disabled:opacity-40"><ChevronRight size={14} /></button>
      </div>
    </>
  );
}

import { Fragment } from "react";

export default function LogsPage() {
  const [tab, setTab] = useState<"timeline" | "audit">("audit");
  return (
    <SettingsShell>
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.5rem]">Log ระบบ</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">Audit = ใครทำอะไร กับรายการไหน เมื่อไร จากที่ไหน (append-only, ตรวจย้อนได้) · ไทม์ไลน์ = ความเคลื่อนไหวของ Lead ที่ระบบบันทึกเอง</p>
      </div>
      <div className="flex gap-1 border-b border-[var(--border)]">
        {([["audit", "Audit"], ["timeline", "ไทม์ไลน์ Lead"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-[.82rem] -mb-px border-b-2 ${tab === k ? "border-[var(--primary)] font-medium text-[var(--text)]" : "border-transparent text-[var(--text-3)]"}`}>{label}</button>
        ))}
      </div>
      {tab === "audit" ? <Audit /> : <Timeline />}
    </div>
    </SettingsShell>
  );
}
