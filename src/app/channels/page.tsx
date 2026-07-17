"use client";

// Channels screen (handoff §5.1): table of fun_channel_config — FB page →
// brand/branch → LINE group. Adding a brand/branch = adding a row here; no
// code changes (§8 rollout plan).
//
// Rebuilt 2026-07-15 (user req: "หน้านี้ใช้ไม่ได้แล้ว") — the brand dropdown
// used to be a hardcoded lowercase slug list in src/lib/types.ts that never
// got new brands added later (GAC, Lepas missing — there was no way to map
// a channel to them at all). Brand/branch are now live selects sourced from
// /api/branches, and the value stored is the REAL brand/branch identity
// (brandName / branchCode) — ingestLead() in src/lib/leads.ts matches
// fun_channel_config.brand against Brand.brandName and auto-CREATES a new
// Brand row if nothing matches, so a typo'd or stale string here used to be
// able to silently spawn a duplicate brand. Sourcing the value directly from
// the live Brand/Branch tables removes that risk. Google Sheet field
// dropped entirely — grepped the whole app, gsheetId was never read
// anywhere outside this page/its API routes, pure dead storage.

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw } from "lucide-react";
import { Card, Toggle, inputCls } from "@/components/ui";
import { SettingsShell } from "@/components/SettingsShell";

type ChannelRow = {
  configId: number;
  fbPageId: string;
  fbPageName: string | null;
  brand: string;
  branchCode: string;
  lineGroupId: string;
  active: boolean;
};
type BrandRow = { brandId: number; brandName: string };
type BranchRow = { branchId: number; branchName: string; branchCode: string | null; brandId: number | null };

type Draft = { fbPageId: string; fbPageName: string; brandId: string; branchId: string; lineGroupId: string };
const EMPTY: Draft = { fbPageId: "", fbPageName: "", brandId: "", branchId: "", lineGroupId: "" };

export default function ChannelsPage() {
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Group ID auto-captured by /api/webhooks/line (CATS trick).
  const [lastGroup, setLastGroup] = useState<{ id: string; at: string } | null>(null);

  const load = async () => {
    const [chRes, brRes, stRes] = await Promise.all([fetch("/api/channels"), fetch("/api/branches?all=1"), fetch("/api/settings")]);
    setRows(await chRes.json());
    const br = await brRes.json().catch(() => ({}));
    setBrands(br.brands ?? []); setBranches(br.branches ?? []);
    const st = await stRes.json().catch(() => ({}));
    setLastGroup(st.line_last_group_id ?? null);
  };
  useEffect(() => { load(); }, []);

  const brandName = (name: string) => brands.find((b) => b.brandName.toLowerCase() === name.toLowerCase())?.brandName ?? name;
  const branchLabel = (code: string) => branches.find((b) => (b.branchCode ?? b.branchName) === code)?.branchName ?? code;
  const branchOptions = draft.brandId ? branches.filter((b) => b.brandId === Number(draft.brandId)) : [];

  const startEdit = (r: ChannelRow) => {
    setEditingId(r.configId);
    const brand = brands.find((b) => b.brandName.toLowerCase() === r.brand.toLowerCase());
    const branch = branches.find((b) => (b.branchCode ?? b.branchName) === r.branchCode);
    setDraft({
      fbPageId: r.fbPageId, fbPageName: r.fbPageName ?? "",
      brandId: brand ? String(brand.brandId) : "", branchId: branch ? String(branch.branchId) : "",
      lineGroupId: r.lineGroupId,
    });
    setError(null);
  };

  const cancel = () => { setEditingId(null); setDraft(EMPTY); setError(null); };

  async function save() {
    const brand = brands.find((b) => b.brandId === Number(draft.brandId));
    const branch = branches.find((b) => b.branchId === Number(draft.branchId));
    if (!draft.fbPageId.trim() || !brand || !branch || !draft.lineGroupId.trim()) {
      setError("กรอก FB Page ID, แบรนด์, สาขา, และ LINE Group ID ให้ครบ");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      fbPageId: draft.fbPageId, fbPageName: draft.fbPageName,
      brand: brand.brandName, branchCode: branch.branchCode ?? branch.branchName,
      lineGroupId: draft.lineGroupId,
    };
    const url = editingId === null ? "/api/channels" : `/api/channels/${editingId}`;
    const res = await fetch(url, {
      method: editingId === null ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        title="Channels — FB Page → LINE Group"
        desc="กำหนดว่า Lead จากเพจไหน ส่งเข้ากลุ่ม LINE ไหน. เพิ่มแบรนด์/สาขาใหม่ที่ /settings/branches ก่อน แล้วค่อยมาผูก channel ที่นี่"
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
                    <td className="py-2 pr-3">{brandName(r.brand)}</td>
                    <td className="py-2 pr-3">{branchLabel(r.branchCode)}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{r.lineGroupId.slice(0, 12)}…</td>
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
            <select value={draft.brandId} onChange={e => setDraft({ ...draft, brandId: e.target.value, branchId: "" })} className={inputCls}>
              <option value="">— เลือกแบรนด์ —</option>
              {brands.map(b => <option key={b.brandId} value={b.brandId}>{b.brandName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">สาขา *</span>
            <select value={draft.branchId} onChange={e => setDraft({ ...draft, branchId: e.target.value })} className={inputCls} disabled={!draft.brandId}>
              <option value="">{draft.brandId ? "— เลือกสาขา —" : "เลือกแบรนด์ก่อน"}</option>
              {branchOptions.map(b => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className="text-[11px] font-medium text-[var(--muted-foreground)] mb-1 block">LINE Group ID (กลุ่มเซลล์) *</span>
            <input value={draft.lineGroupId} onChange={e => setDraft({ ...draft, lineGroupId: e.target.value })}
              placeholder="Cxxxxxxxx…" className={inputCls + " font-mono text-xs"} />
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
