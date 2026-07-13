"use client";

// Manager dashboard v2 (user req 2026-07-11, brainstormed layout — "ทุกตัวเลข
// ต้องนำไปสู่การกระทำของ ผจก. ได้"):
//   ① Action Zone (top): pending SLA escalations with inline action buttons
//     (same actions as the LINE card, no LINE hunting), stale HOT leads,
//     unclaimed pool, unanswered customer chats.
//   ② Team Scorecard: per-salesperson working table, sorted worst-first.
//   ③ Funnel + temperature + recent SLA events (kept from v1).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle, Flame, Inbox as InboxIcon, AlertOctagon } from "lucide-react";

type Dash = {
  active: number; dueToday: number; openBreaches: number; poolWaiting: number; conflicts: number;
  byTemperature: Record<string, number>;
  byStage: Record<string, number>;
  recentEvents: { eventId: number; type: string; at: string | null; resolved: boolean; resolution: string | null; leadId: number; customerName: string; brand: string }[];
  actionZone: {
    escalations: { leadId: number; customerName: string; brand: string; daysWaiting: number | null }[];
    staleHot: { leadId: number; customerName: string; brand: string; daysIdle: number | null }[];
    pool: { waiting: number; oldestDays: number | null };
    unansweredChats: { leadId: number; customerName: string; brand: string; ownerName: string | null; hoursWaiting: number | null }[];
    unansweredTotal: number;
  };
  scorecard: {
    userId: number; name: string; leadsHeld: number; overdue: number;
    avgFirstResponseMin: number | null; activitiesPerDay: number; bookingsMonth: number; conversion: number | null;
  }[];
};

const STAGE_ORDER = ["new", "contacted", "qualified", "appointment", "test_drive", "negotiation", "finance_check", "booking"];
const STAGE_TH: Record<string, string> = {
  new: "Lead ใหม่", contacted: "ติดต่อแล้ว", qualified: "คัดกรอง", appointment: "นัดหมาย",
  test_drive: "ทดลองขับ", negotiation: "ต่อรอง", finance_check: "ไฟแนนซ์", booking: "จอง",
};
const EVENT_TH: Record<string, string> = {
  first_response_breach: "ไม่ตอบลูกค้าใหม่ทันเวลา", followup_overdue: "เกินรอบติดตาม",
  idle_nudge: "เตือนเซลส์ (idle)", idle_escalate: "แจ้ง ผจก. (idle)", idle_forfeit: "ริบเข้า pool", forfeit_warning: "ใกล้ถูกริบ",
};

const fmtResponse = (min: number | null) => {
  if (min === null) return "—";
  if (min < 60) return `${min} นาที`;
  if (min < 60 * 24) return `${Math.round(min / 60)} ชม.`;
  return `${Math.round(min / 60 / 24)} วัน`;
};

export default function DashboardPage() {
  const [d, setD] = useState<Dash | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = () => fetch("/api/dashboard").then((r) => r.json()).then(setD);
  useEffect(() => { load(); }, []);

  async function slaAction(action: "nudge_again" | "reassign", leadId: number) {
    setActing(`${action}:${leadId}`); setActionMsg(null);
    const res = await fetch("/api/governance/sla-action", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, leadId }),
    });
    const data = await res.json().catch(() => ({}));
    setActing(null);
    setActionMsg(data.message ?? data.error ?? null);
    load();
  }

  const maxStage = d ? Math.max(1, ...STAGE_ORDER.map((s) => d.byStage[s] ?? 0)) : 1;
  const az = d?.actionZone;
  const hasActions = az && (az.escalations.length > 0 || az.staleHot.length > 0 || az.pool.waiting > 0 || az.unansweredTotal > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.7rem]">Dashboard ทีมขาย</h1>
        <p className="text-[var(--text-2)] text-[.95rem]">สิ่งที่ต้องจัดการวันนี้ · ผลงานรายเซลส์ · สุขภาพ pipeline</p>
      </div>

      {/* ── ① Action Zone ─────────────────────────────────────────────── */}
      {actionMsg && (
        <div className="bg-[var(--green-soft)] border border-[var(--green)] rounded-xl px-4 py-2.5 text-[.82rem]">{actionMsg}</div>
      )}
      {!d ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : hasActions ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {az!.escalations.length > 0 && (
            <div className="bg-white border-2 border-[var(--red)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
              <div className="px-4 py-3 bg-[var(--red-soft)] flex items-center gap-2">
                <AlertOctagon size={16} className="text-[var(--red)]" />
                <h3 className="text-[.9rem] font-semibold text-[var(--red)]">รอ ผจก. ตัดสินใจ ({az!.escalations.length})</h3>
              </div>
              {az!.escalations.map((e) => (
                <div key={e.leadId} className="px-4 py-2.5 border-b border-[var(--border)] last:border-0 flex items-center gap-2 flex-wrap text-[.82rem]">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{e.customerName}</span>
                    <span className="text-[var(--text-2)]"> · {e.brand}{e.daysWaiting !== null ? ` · รอ ${e.daysWaiting} วัน` : ""}</span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => slaAction("nudge_again", e.leadId)} disabled={acting !== null}
                      className="px-2.5 py-1 rounded-lg text-[.72rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)] disabled:opacity-50">
                      {acting === `nudge_again:${e.leadId}` ? <Loader2 size={11} className="animate-spin" /> : "เตือนอีกครั้ง"}
                    </button>
                    <button onClick={() => slaAction("reassign", e.leadId)} disabled={acting !== null}
                      className="px-2.5 py-1 rounded-lg text-[.72rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
                      {acting === `reassign:${e.leadId}` ? <Loader2 size={11} className="animate-spin" /> : "ย้ายเข้า pool"}
                    </button>
                    <Link href={`/governance/exempt?lead=${e.leadId}`}
                      className="px-2.5 py-1 rounded-lg text-[.72rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">
                      ยกเว้น
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          {az!.unansweredTotal > 0 && (
            <div className="bg-white border-2 border-[var(--amber)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
              <div className="px-4 py-3 bg-[var(--amber-soft)] flex items-center gap-2">
                <MessageCircle size={16} className="text-[var(--amber)]" />
                <h3 className="text-[.9rem] font-semibold text-[var(--amber)]">ลูกค้าทักแชท ยังไม่มีใครตอบ ({az!.unansweredTotal})</h3>
              </div>
              {az!.unansweredChats.map((c) => (
                <Link key={c.leadId} href="/chat" className="px-4 py-2.5 border-b border-[var(--border)] last:border-0 flex items-center gap-2 text-[.82rem] hover:bg-[var(--surface-2)] transition">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{c.customerName}</span>
                    <span className="text-[var(--text-2)]"> · {c.brand}{c.ownerName ? ` · เซลส์ ${c.ownerName}` : ""}</span>
                  </div>
                  <span className="text-[.72rem] text-[var(--amber)] font-medium shrink-0">
                    {c.hoursWaiting !== null ? (c.hoursWaiting < 1 ? "ไม่ถึง 1 ชม." : `รอ ${c.hoursWaiting} ชม.`) : ""}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {az!.staleHot.length > 0 && (
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <Flame size={16} className="text-[var(--red)]" />
                <h3 className="text-[.9rem] font-semibold">HOT ค้างเกิน 7 วัน ({az!.staleHot.length})</h3>
              </div>
              {az!.staleHot.map((l) => (
                <Link key={l.leadId} href={`/lead-center`} className="px-4 py-2.5 border-b border-[var(--border)] last:border-0 flex items-center gap-2 text-[.82rem] hover:bg-[var(--surface-2)] transition">
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{l.customerName}</span>
                    <span className="text-[var(--text-2)]"> · {l.brand}</span>
                  </div>
                  <span className="text-[.72rem] text-[var(--red)] font-medium shrink-0">เงียบ {l.daysIdle} วัน</span>
                </Link>
              ))}
            </div>
          )}

          {az!.pool.waiting > 0 && (
            <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-4 flex items-center gap-3">
              <InboxIcon size={20} className="text-[var(--amber)] shrink-0" />
              <div className="flex-1">
                <div className="text-[.86rem] font-medium">Pool มี Lead รอรับ {az!.pool.waiting} ราย</div>
                {az!.pool.oldestDays !== null && az!.pool.oldestDays > 0 && (
                  <div className="text-[.74rem] text-[var(--text-2)]">รอนานสุด {az!.pool.oldestDays} วัน — ยิ่งค้างยิ่งเย็น</div>
                )}
              </div>
              <Link href="/pool" className="px-3 py-1.5 rounded-lg text-[.78rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] shrink-0">
                ไปแจกงาน →
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[var(--green-soft)] border border-[var(--green)] rounded-2xl px-5 py-4 text-[.9rem]">
          ✅ ไม่มีเรื่องค้างต้องจัดการ — ทีมตามงานครบ
        </div>
      )}

      {/* ── ② Team Scorecard ──────────────────────────────────────────── */}
      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h3 className="text-base">ผลงานรายเซลส์</h3>
          <span className="text-[.7rem] text-[var(--text-3)]">ตอบสนอง = เฉลี่ย 90 วัน · กิจกรรม = เฉลี่ย 7 วัน · จอง = เดือนนี้ · Conversion = cohort 90 วัน</span>
        </div>
        {!d ? <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p> :
          d.scorecard.length === 0 ? <p className="p-5 text-sm text-[var(--text-2)]">ยังไม่มีเซลส์ในระบบ</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[var(--text-3)] border-b border-[var(--border)]">
                  <th className="py-2.5 px-4">เซลส์</th>
                  <th className="py-2.5 pr-3 text-right">Lead ในมือ</th>
                  <th className="py-2.5 pr-3 text-right">เกินกำหนด</th>
                  <th className="py-2.5 pr-3 text-right">ตอบสนองครั้งแรก</th>
                  <th className="py-2.5 pr-3 text-right">กิจกรรม/วัน</th>
                  <th className="py-2.5 pr-3 text-right">จองเดือนนี้</th>
                  <th className="py-2.5 pr-4 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {d.scorecard.map((s) => (
                  <tr key={s.userId} className={`border-b border-[var(--border)] last:border-0 ${s.overdue >= 3 ? "bg-[var(--red-soft)]/40" : ""}`}>
                    <td className="py-2.5 px-4 font-medium">{s.name}</td>
                    <td className="py-2.5 pr-3 text-right num">{s.leadsHeld}</td>
                    <td className={`py-2.5 pr-3 text-right num font-medium ${s.overdue > 0 ? "text-[var(--red)]" : "text-[var(--text-3)]"}`}>{s.overdue}</td>
                    <td className={`py-2.5 pr-3 text-right num ${s.avgFirstResponseMin !== null && s.avgFirstResponseMin > 240 ? "text-[var(--red)]" : ""}`}>{fmtResponse(s.avgFirstResponseMin)}</td>
                    <td className="py-2.5 pr-3 text-right num">{s.activitiesPerDay}</td>
                    <td className="py-2.5 pr-3 text-right num font-medium">{s.bookingsMonth}</td>
                    <td className="py-2.5 pr-4 text-right num">{s.conversion !== null ? `${s.conversion}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ③ funnel + recent events (v1, kept) ───────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { l: "Lead active", v: d?.active, cls: "" },
          { l: "ต้องตามวันนี้", v: d?.dueToday, cls: "text-[var(--accent-text)]" },
          { l: "SLA ค้างจัดการ", v: d?.openBreaches, cls: "text-[var(--red)]" },
          { l: "รอใน pool", v: d?.poolWaiting, cls: "text-[var(--amber)]" },
          { l: "⚠ AI ขัดแย้ง", v: d?.conflicts, cls: "text-[var(--amber)]" },
        ].map((c) => (
          <div key={c.l} className="bg-white border border-[var(--border)] rounded-xl px-4 py-3 shadow-[var(--shadow)]">
            <div className="text-[.72rem] text-[var(--text-2)]">{c.l}</div>
            <div className={`text-2xl font-semibold num ${c.cls}`}>{c.v ?? "…"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-5">
          <h3 className="text-base mb-4">Funnel ตามขั้นตอน</h3>
          {!d ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
            <div className="space-y-2">
              {STAGE_ORDER.map((s) => {
                const v = d.byStage[s] ?? 0;
                return (
                  <div key={s} className="flex items-center gap-3 text-[.82rem]">
                    <span className="w-20 shrink-0 text-[var(--text-2)]">{STAGE_TH[s]}</span>
                    <div className="flex-1 h-5 bg-[var(--bg)] rounded-md overflow-hidden">
                      <div className="h-full bg-[var(--primary)] rounded-md transition-all" style={{ width: `${(v / maxStage) * 100}%`, opacity: v ? 1 : 0 }} />
                    </div>
                    <span className="w-8 text-right num font-medium">{v}</span>
                  </div>
                );
              })}
            </div>
          )}
          {d && (
            <div className="flex gap-4 mt-5 pt-4 border-t border-[var(--border)] text-[.8rem]">
              <span className="text-[var(--red)] font-medium">HOT {d.byTemperature.hot ?? 0}</span>
              <span className="text-[var(--amber)] font-medium">WARM {d.byTemperature.warm ?? 0}</span>
              <span className="text-[var(--text-3)] font-medium">COLD {d.byTemperature.cold ?? 0}</span>
              <span className="text-[var(--text-3)]">ยังไม่ประเมิน {d.byTemperature.unscored ?? 0}</span>
            </div>
          )}
        </div>

        <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
            <h3 className="text-base">เหตุการณ์ SLA ล่าสุด</h3>
            <Link href="/pool" className="text-[.76rem] text-[var(--accent-text)] hover:underline">ไปที่ Lead Pool →</Link>
          </div>
          {!d ? <p className="p-5 text-sm text-[var(--text-2)]">Loading…</p> :
            d.recentEvents.length === 0 ? <p className="p-5 text-sm text-[var(--text-2)]">ยังไม่มีเหตุการณ์ SLA 🎉</p> : (
            d.recentEvents.map((e) => (
              <div key={e.eventId} className="px-5 py-3 border-b border-[var(--border)] last:border-0 flex items-center gap-3 text-[.82rem]">
                <span className={`h-2 w-2 rounded-full shrink-0 ${e.resolved ? "bg-[var(--green)]" : "bg-[var(--red)]"}`} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{e.customerName}</span>
                  <span className="text-[var(--text-2)]"> · {e.brand} · {EVENT_TH[e.type] ?? e.type}</span>
                </div>
                <span className="text-[.72rem] text-[var(--text-3)] shrink-0">
                  {e.resolved ? (e.resolution ?? "จัดการแล้ว") : "ยังไม่จัดการ"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
