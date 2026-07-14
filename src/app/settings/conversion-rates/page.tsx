"use client";

// Weighted Pipeline / Lead Aging assumptions (user req 2026-07-11) — the
// probabilities feed the Weighted Pipeline card on /runrate, and hotAgingDays
// drives the hourly HOT→WARM auto-downgrade in runSlaJob (src/lib/jobs/sla.ts).

import { useEffect, useState } from "react";
import { Loader2, Check } from "lucide-react";
import { SettingsShell } from "@/components/SettingsShell";
import { Card, inputCls } from "@/components/ui";
import type { ConversionRateConfig } from "@/lib/settings";

export default function ConversionRatesPage() {
  const [config, setConfig] = useState<ConversionRateConfig | null>(null);
  const [draft, setDraft] = useState<Record<keyof ConversionRateConfig, string>>({
    hotProbabilityPct: "", warmProbabilityPct: "", coldProbabilityPct: "", hotAgingDays: "", leadsPerBooking: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/conversion-rates").then((r) => r.json()).then((c: ConversionRateConfig) => {
      setConfig(c);
      setDraft({
        hotProbabilityPct: String(c.hotProbabilityPct), warmProbabilityPct: String(c.warmProbabilityPct),
        coldProbabilityPct: String(c.coldProbabilityPct), hotAgingDays: String(c.hotAgingDays),
        leadsPerBooking: String(c.leadsPerBooking ?? 10),
      });
    });
  }, []);

  async function save() {
    setSaving(true); setSaved(false); setError(null);
    const res = await fetch("/api/settings/conversion-rates", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hotProbabilityPct: Number(draft.hotProbabilityPct),
        warmProbabilityPct: Number(draft.warmProbabilityPct),
        coldProbabilityPct: Number(draft.coldProbabilityPct),
        hotAgingDays: Number(draft.hotAgingDays),
        leadsPerBooking: Number(draft.leadsPerBooking),
      }),
    });
    setSaving(false);
    if (res.ok) { const d = await res.json(); setConfig(d.config); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    else setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ");
  }

  const previewWeighted = config
    ? `เช่น Lead HOT 10 ราย × ${draft.hotProbabilityPct || 0}% + WARM 20 ราย × ${draft.warmProbabilityPct || 0}% ≈ คาดจอง ${
        Math.round(10 * (Number(draft.hotProbabilityPct) || 0) / 100 + 20 * (Number(draft.warmProbabilityPct) || 0) / 100)
      } คัน`
    : "";

  return (
    <SettingsShell>
      <div>
        <h1 className="text-[1.5rem]">Conversion Rate / Weighted Pipeline</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">
          ค่าโอกาสปิดการขายต่ออุณหภูมิ Lead — ใช้คำนวณ Run Rate แบบถ่วงน้ำหนัก (Weighted Pipeline) และเกณฑ์วันที่ Lead HOT ค้างนานเกินจะปรับลดอุณหภูมิอัตโนมัติ
        </p>
      </div>

      {config === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
        <>
          <Card title="โอกาสปิดการขายต่ออุณหภูมิ (%)" desc="ใช้คูณกับจำนวน Lead ที่เปิดอยู่ในแต่ละอุณหภูมิ เพื่อพยากรณ์ยอดจอง">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">🔥 HOT (%)</span>
                <input type="number" min={0} max={100} value={draft.hotProbabilityPct}
                  onChange={(e) => setDraft({ ...draft, hotProbabilityPct: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">🌤️ WARM (%)</span>
                <input type="number" min={0} max={100} value={draft.warmProbabilityPct}
                  onChange={(e) => setDraft({ ...draft, warmProbabilityPct: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">❄️ COLD (%)</span>
                <input type="number" min={0} max={100} value={draft.coldProbabilityPct}
                  onChange={(e) => setDraft({ ...draft, coldProbabilityPct: e.target.value })} className={inputCls} />
              </label>
            </div>
            {previewWeighted && <p className="text-[.76rem] text-[var(--text-3)] mt-1">{previewWeighted}</p>}
          </Card>

          <Card title="ตัวคูณเป้า Lead (Lead ต่อ 1 จอง)" desc="หน้า Run Rate ใช้ตัวเลขนี้คูณกับเป้าจองของผจก. เพื่อแสดงเป้า Lead ประจำเดือนอัตโนมัติ — ไม่ต้องกรอกเป้า Lead แยกอีกช่อง (เช่น เป้าจอง 10 × 10 = ต้องหา Lead 100 ราย)">
            <label className="block max-w-xs">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">Lead ที่ต้องหา ต่อ 1 เคสจอง</span>
              <div className="flex items-center gap-2">
                <input type="number" min={1} step={0.5} value={draft.leadsPerBooking}
                  onChange={(e) => setDraft({ ...draft, leadsPerBooking: e.target.value })} className={inputCls} />
                <span className="text-[.8rem] text-[var(--text-2)] shrink-0">ราย/จอง</span>
              </div>
            </label>
          </Card>

          <Card title="เกณฑ์ Lead Aging" desc="Lead HOT ที่ไม่มีความเคลื่อนไหวนานเกินกำหนดนี้ จะถูกปรับลดอุณหภูมิเป็น WARM อัตโนมัติ (ความอยากซื้อลดลงตามเวลา)">
            <label className="block max-w-xs">
              <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">จำนวนวัน</span>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={draft.hotAgingDays}
                  onChange={(e) => setDraft({ ...draft, hotAgingDays: e.target.value })} className={inputCls} />
                <span className="text-[.8rem] text-[var(--text-2)] shrink-0">วัน</span>
              </div>
            </label>
          </Card>

          {error && <p className="text-[.8rem] text-[var(--red)]">❌ {error}</p>}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
            {saved ? <><Check size={14} /> บันทึกแล้ว</> : saving ? <Loader2 size={14} className="animate-spin" /> : "บันทึก"}
          </button>

          <p className="text-[.74rem] text-[var(--text-3)]">
            ค่าเหล่านี้ใช้คำนวณการ์ด &quot;Weighted Pipeline&quot; ในหน้า Run Rate และการลดระดับ HOT → WARM อัตโนมัติ (ทำงานทุกชั่วโมงพร้อม SLA engine)
          </p>
        </>
      )}
    </SettingsShell>
  );
}
