"use client";

// Per-brand LINE OA (user req 2026-07-11) — each brand now runs its own LINE
// Official Account (its own Messaging API channel), shared by every branch
// that sells that brand, so sales stay with a customer until the customer
// decides, instead of chat/leads crossing brands whenever a customer's QR
// scans land on different brands. Credentials come from LINE Developers
// Console → Messaging API tab for that brand's channel: Channel Access Token
// and Channel Secret.
//
// The bot's own userId ("destination", used to route the shared webhook URL
// to the right brand) is deliberately NOT collected here — LINE's console
// doesn't expose a copyable field for it anywhere (confirmed live
// 2026-07-11; the field some docs call "Bot user ID" isn't on the actual
// Messaging API settings page). It's auto-detected instead, the first time
// this brand's channel sends a real webhook event, by testing the signature
// against every configured secret — see resolveLineCreds in
// src/lib/lineConfig.ts. Shown here read-only once known, purely informational.
//
// LIFF (customer QR→registration) is a SEPARATE, independent config on the
// same row — each brand's own LINE Login channel (linked 1:1 to its
// Messaging channel) hosts its own LIFF app; only the LIFF app id is needed
// here (non-secret, embedded directly in customer-facing QR URLs). A brand
// can have one configured without the other.

import { useEffect, useState } from "react";
import { Loader2, Check, Pencil, X } from "lucide-react";
import { SettingsShell } from "@/components/SettingsShell";
import { Card, Toggle, inputCls } from "@/components/ui";

type Row = {
  brandId: number; brandName: string;
  messagingConfigured: boolean; isActive: boolean; destination: string | null; accessTokenTail: string | null;
  quotaLimit: number | null; quotaUsed: number | null;
  liffId: string | null;
};
type Draft = { channelAccessToken: string; channelSecret: string };
const EMPTY: Draft = { channelAccessToken: "", channelSecret: "" };

export default function LineOaSettingsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [liffDraft, setLiffDraft] = useState<Record<number, string>>({});
  const [liffSavingId, setLiffSavingId] = useState<number | null>(null);

  const load = () => fetch("/api/settings/line-oa").then((r) => r.json()).then((rs: Row[]) => {
    setRows(rs);
    setLiffDraft(Object.fromEntries(rs.map((r) => [r.brandId, r.liffId ?? ""])));
  });
  useEffect(() => { load(); }, []);

  const startEdit = (r: Row) => { setEditingId(r.brandId); setDraft(EMPTY); setError(null); };
  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save(brandId: number) {
    if (!draft.channelAccessToken.trim() || !draft.channelSecret.trim()) {
      setError("กรุณากรอกให้ครบทั้ง 2 ช่อง"); return;
    }
    setSaving(true); setError(null);
    const res = await fetch(`/api/settings/line-oa/${brandId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    if (res.ok) { cancel(); load(); } else { setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ"); }
    setSaving(false);
  }

  async function toggleActive(r: Row) {
    await fetch(`/api/settings/line-oa/${r.brandId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !r.isActive }),
    });
    load();
  }

  async function saveLiff(brandId: number) {
    setLiffSavingId(brandId);
    await fetch(`/api/settings/line-oa/${brandId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ liffId: liffDraft[brandId] ?? "" }),
    });
    setLiffSavingId(null);
    load();
  }

  return (
    <SettingsShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-[1.5rem]">LINE OA แต่ละยี่ห้อ</h1>
          <p className="text-[var(--text-2)] text-[.9rem]">
            แต่ละยี่ห้อมี LINE Official Account ของตัวเอง (ใช้ร่วมกันทุกสาขาที่ขายยี่ห้อนั้น) — ลูกค้าคุยกับเซลส์ต่อเนื่องจนตัดสินใจ ไม่ปนกับยี่ห้ออื่น
          </p>
        </div>

        <Card title="Messaging API — สำหรับแชท/ส่งข้อความ" desc="ยี่ห้อที่ยังไม่ตั้งค่าจะใช้ LINE OA กลางชั่วคราว (ทยอยตั้งค่าได้ทีละยี่ห้อ)">
          {rows === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
              {rows.map((r) => (
                <div key={r.brandId} className="bg-white">
                  <div className={`flex items-center gap-3 px-4 py-2.5 ${!r.messagingConfigured ? "opacity-70" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{r.brandName}</span>
                      <div className="text-[.72rem] text-[var(--text-3)] mt-0.5">
                        {r.messagingConfigured ? (
                          <>ตั้งค่าแล้ว · Token ลงท้าย ••{r.accessTokenTail} · {r.destination ? `ตรวจพบ bot แล้ว (${r.destination})` : "ยังไม่มีข้อความเข้ามา — จะตรวจพบอัตโนมัติทันทีที่มีลูกค้าทักเข้า OA นี้"}</>
                        ) : (
                          <>ยังไม่ตั้งค่า — ใช้ LINE OA กลางชั่วคราว</>
                        )}
                      </div>
                    </div>
                    {r.messagingConfigured && r.quotaUsed !== null && (
                      // Monthly push-message usage (LINE quota API). Free-plan
                      // cap turns amber past 80% so an admin sees it coming.
                      <span className={`text-[.7rem] font-medium px-2 py-0.5 rounded-full num shrink-0 ${
                        r.quotaLimit !== null && r.quotaUsed / r.quotaLimit >= 0.8
                          ? "bg-[var(--amber-soft)] text-[var(--amber)]"
                          : "bg-[var(--surface-2)] text-[var(--text-2)]"}`}
                        title="ข้อความ push ที่ใช้ไปเดือนนี้ / โควต้าแผน">
                        {r.quotaUsed.toLocaleString()}{r.quotaLimit !== null ? ` / ${r.quotaLimit.toLocaleString()}` : ""} ข้อความ
                      </span>
                    )}
                    {r.messagingConfigured && <Toggle on={r.isActive} onClick={() => toggleActive(r)} />}
                    <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-[var(--accent-soft)]" title={r.messagingConfigured ? "แก้ไข" : "ตั้งค่า"}>
                      <Pencil size={14} />
                    </button>
                  </div>

                  {editingId === r.brandId && (
                    <div className="px-4 pb-4 pt-1 space-y-3 bg-[var(--bg)]">
                      <p className="text-[.7rem] text-[var(--text-3)]">
                        เอาค่าจาก LINE Developers Console → เลือก <b>Messaging API channel</b> ของยี่ห้อนี้ → แท็บ Messaging API settings → หัวข้อ &quot;Channel access token&quot; (กรอกใหม่ทุกครั้งที่แก้ไข — ระบบไม่แสดง token/secret เดิม)
                      </p>
                      <div className="grid md:grid-cols-2 gap-3">
                        <label className="block">
                          <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">Channel Access Token (long-lived) *</span>
                          <input value={draft.channelAccessToken} onChange={(e) => setDraft({ ...draft, channelAccessToken: e.target.value })} className={inputCls + " font-mono"} type="password" />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">Channel Secret *</span>
                          <input value={draft.channelSecret} onChange={(e) => setDraft({ ...draft, channelSecret: e.target.value })} className={inputCls + " font-mono"} type="password" />
                        </label>
                      </div>
                      <p className="text-[10px] text-[var(--text-3)]">ไม่ต้องหา &quot;Bot user ID&quot; — ระบบตรวจจับยี่ห้อให้อัตโนมัติจากข้อความแรกที่ลูกค้าทักเข้ามา (เทียบลายเซ็นกับ Channel Secret ของแต่ละยี่ห้อ)</p>
                      {error && <p className="text-xs text-[var(--red)]">❌ {error}</p>}
                      <div className="flex items-center gap-2">
                        <button onClick={() => save(r.brandId)} disabled={saving}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
                          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} บันทึก
                        </button>
                        <button onClick={cancel} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">
                          <X size={14} /> ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="LIFF App ID — สำหรับหน้าลงทะเบียนลูกค้า (สแกน QR)" desc="เอา LIFF ID จาก LINE Login channel ของยี่ห้อนั้น (ที่ Link เข้ากับ Messaging API channel ด้านบนแล้ว) — ไม่ใช่ข้อมูลลับ ใส่ได้ตรงๆ">
          {rows === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
            <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
              {rows.map((r) => (
                <div key={r.brandId} className="flex items-center gap-3 px-4 py-2.5 bg-white">
                  <span className="text-sm font-medium w-28 shrink-0 truncate">{r.brandName}</span>
                  <input
                    value={liffDraft[r.brandId] ?? ""}
                    onChange={(e) => setLiffDraft((d) => ({ ...d, [r.brandId]: e.target.value }))}
                    className={inputCls + " font-mono flex-1"}
                    placeholder="ยังไม่ตั้งค่า — ใช้ LIFF กลางชั่วคราว"
                  />
                  <button onClick={() => saveLiff(r.brandId)} disabled={liffSavingId === r.brandId}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50 shrink-0">
                    {liffSavingId === r.brandId ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} บันทึก
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </SettingsShell>
  );
}
