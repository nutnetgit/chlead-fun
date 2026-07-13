"use client";

// Channels screen (handoff §5.1): table of fun_channel_config —
// FB page → brand → branch → LINE group → Google Sheet.
// Adding a brand/branch = adding a row here; no code changes (§8 rollout plan).

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw } from "lucide-react";
import { BRANDS, BRAND_LABELS, type ChannelRow } from "@/lib/types";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type Draft = {
  fbPageId: string;
  fbPageName: string;
  brand: string;
  branchCode: string;
  lineGroupId: string;
  gsheetId: string;
};

const EMPTY: Draft = { fbPageId: "", fbPageName: "", brand: "mazda", branchCode: "", lineGroupId: "", gsheetId: "" };

export default function ChannelsPage() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Group ID auto-captured by /api/webhooks/line (CATS trick).
  const [lastGroup, setLastGroup] = useState<{ id: string; at: string } | null>(null);

  const load = async () => {
    const [chRes, stRes] = await Promise.all([fetch("/api/channels"), fetch("/api/settings")]);
    setRows(await chRes.json());
    const st = await stRes.json().catch(() => ({}));
    setLastGroup(st.line_last_group_id ?? null);
  };
  useEffect(() => { load(); }, []);

  const startEdit = (r: ChannelRow) => {
    setEditingId(r.configId);
    setDraft({
      fbPageId: r.fbPageId,
      fbPageName: r.fbPageName ?? "",
      brand: r.brand,
      branchCode: r.branchCode,
      lineGroupId: r.lineGroupId,
      gsheetId: r.gsheetId ?? "",
    });
  };

  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    setSaving(true);
    setError(null);
    const url = editingId === null ? "/api/channels" : `/api/channels/${editingId}`;
    const res = await fetch(url, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (res.ok) {
      cancel();
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "บันทึกไม่สำเร็จ");
    }
    setSaving(false);
  }

  async function toggleActive(r: ChannelRow) {
    await fetch(`/api/channels/${r.configId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: r.active ? 0 : 1 }),
    });
    await load();
  }

  async function remove(r: ChannelRow) {
    if (!confirm(`ลบ mapping ของเพจ "${r.fbPageName || r.fbPageId}"?`)) return;
    await fetch(`/api/channels/${r.configId}`, { method: "DELETE" });
    await load();
  }

  return (
    <SettingsShell>
    <div className="space-y-4">
      <Card
        title="Channels — FB Page → LINE Group → Google Sheet"
        desc="กำหนดว่า Lead จากเพจไหน ส่งเข้ากลุ่ม LINE ไหน และบันทึกลง Sheet ไหน. เพิ่มแบรนด์/สาขาใหม่ = เพิ่มแถวที่นี่ ไม่ต้องแก้ workflow."
      >
        {rows === null ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">ยังไม่มี channel — เพิ่มรายการแรกด้านล่าง</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[var(--muted-foreground)] border-b border-[var(--border)]">
                  <th className="py-2 pr-3">FB Page</th>
                  <th className="py-2 pr-3">แบรนด์</th>
                  <th className="py-2 pr-3">สาขา</th>
                  <th className="py-2 pr-3">LINE Group</th>
                  <th className="py-2 pr-3">Sheet</th>
                  <th className="py-2 pr-3">เปิดใช้</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.configId} className="border-b border-[var(--border)] last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{r.fbPageName || "—"}</div>
                      <div className="font-mono text-[11px] text-[var(--muted-foreground)]">{r.fbPageId}</div>
                    </td>
                    <td className="py-2 pr-3 capitalize">{BRAND_LABELS[r.brand as keyof typeof BRAND_LABELS] ?? r.brand}</td>
                    <td className="py-2 pr-3">{r.branchCode}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{r.lineGroupId.slice(0, 12)}…</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{r.gsheetId ? `${r.gsheetId.slice(0, 10)}…` : "—"}</td>
                    <td className="py-2 pr-3"><Toggle on={!!r.active} onClick={() => toggleActive(r)} /></td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-[var(--accent)]" title="แก้ไข"><Pencil size={14} /></button>
                      <button onClick={() => remove(r)} className="p-1.5 rounded hover:bg-[var(--accent)] text-red-600" title="ลบ"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={editingId === null ? "เพิ่ม Channel" : `แก้ไข Channel #${editingId}`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">FB Page ID *</span>
            <input value={draft.fbPageId} onChange={e => setDraft({ ...draft, fbPageId: e.target.value })}
              placeholder="เช่น 104xxxxxxxxxxx" className={inputCls + " font-mono text-xs"} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">ชื่อเพจ</span>
            <input value={draft.fbPageName} onChange={e => setDraft({ ...draft, fbPageName: e.target.value })}
              placeholder="เช่น Mazda ช.เอราวัณ ขอนแก่น" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">แบรนด์ *</span>
            <select value={draft.brand} onChange={e => setDraft({ ...draft, brand: e.target.value })} className={inputCls}>
              {BRANDS.map(b => <option key={b} value={b}>{BRAND_LABELS[b]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">รหัสสาขา *</span>
            <input value={draft.branchCode} onChange={e => setDraft({ ...draft, branchCode: e.target.value })}
              placeholder="เช่น KK01" className={inputCls + " font-mono text-xs"} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">LINE Group ID (กลุ่มเซลล์) *</span>
            <input value={draft.lineGroupId} onChange={e => setDraft({ ...draft, lineGroupId: e.target.value })}
              placeholder="Cxxxxxxxx…" className={inputCls + " font-mono text-xs"} />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">Google Sheet ID</span>
            <input value={draft.gsheetId} onChange={e => setDraft({ ...draft, gsheetId: e.target.value })}
              placeholder="จาก URL ของ spreadsheet (เว้นว่างได้)" className={inputCls + " font-mono text-xs"} />
          </label>
        </div>

        {/* Group-ID capture helper — same UX as CATS Settings → Automation. */}
        <div className="rounded-lg bg-[var(--accent)] border border-[var(--border)] p-3 space-y-1.5">
          <p className="text-[11px] font-semibold">หา LINE Group ID ยังไง?</p>
          <ol className="text-[11px] text-[var(--muted-foreground)] list-decimal list-inside space-y-0.5">
            <li>ตั้ง Webhook ของ LINE OA (CEA Sales Assistant) มาที่ <code className="font-mono bg-white px-1 rounded">https://n8n.ch-erawan.com/webhook/fun-line-events</code> (workflow “[FUN] LINE Group-ID Capture”) — ต้องใช้ URL public ของ n8n เพราะ LINE ต้อง verify ได้ (แอปนี้เป็น LAN)</li>
            <li>เชิญบอทเข้ากลุ่มเซลล์ แล้วพิมพ์ข้อความอะไรก็ได้ในกลุ่ม 1 ครั้ง</li>
            <li>กด “ตรวจหาอีกครั้ง” แล้วกด “ใช้ค่านี้”</li>
          </ol>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={load}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] bg-white hover:bg-[var(--accent)]">
              <RefreshCw size={11} /> ตรวจหาอีกครั้ง
            </button>
            {lastGroup ? (
              <>
                <code className="font-mono text-[11px]">{lastGroup.id}</code>
                <button type="button" onClick={() => setDraft({ ...draft, lineGroupId: lastGroup.id })}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[var(--primary)] text-white hover:opacity-90">
                  ใช้ค่านี้
                </button>
              </>
            ) : (
              <span className="text-[11px] text-[var(--muted-foreground)]">ยังไม่พบ — ทำตามขั้นตอนด้านบนก่อน</span>
            )}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">❌ {error}</p>}
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {editingId === null ? "เพิ่ม Channel" : "บันทึกการแก้ไข"}
          </button>
          {editingId !== null && (
            <button onClick={cancel} className="px-4 py-2 rounded-lg text-sm border border-[var(--border)] bg-white hover:bg-[var(--accent)]">
              ยกเลิก
            </button>
          )}
        </div>
      </Card>
    </div>
    </SettingsShell>
  );
}
