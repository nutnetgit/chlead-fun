"use client";

// Control panel for the automated jobs (SLA/score/nudge/digest) — user req
// 2026-07-08: "ทำเป็นเมนูตั้งค่า พวกที่ปรับได้ เช่นเวลาแจ้งเตือน และ toggle
// เปิดปิดได้". src/instrumentation.ts owns the actual hourly cron trigger
// in-process (n8n only handles the FB webhook intake, not these jobs) — this
// page controls whether each job DOES anything when the tick fires, and for
// the once-daily jobs, which hour they're allowed to fire in. Also controls
// the LINE welcome-push quota (user req 2026-07-08: LINE's free tier is
// ~300 msg/month, easy to exhaust with a per-scan auto-welcome push).

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SettingsShell } from "@/components/SettingsShell";
import { Card, Toggle } from "@/components/ui";
import type { AutomationResponse } from "@/app/api/settings/automation/route";

const JOBS: { key: "sla" | "score" | "nudge" | "digest"; title: string; desc: string; hourly?: boolean }[] = [
  { key: "sla", title: "SLA Engine (นัดหมาย/แจ้งเตือนค้าง)", desc: "ทำงานทุกชั่วโมง — ไม่มีเวลาให้ตั้ง มีแต่เปิด/ปิด", hourly: true },
  { key: "score", title: "Aira ให้คะแนน Lead + วิเคราะห์แชท", desc: "ให้คะแนน Lead ใหม่รายวัน (ตั้งเวลาได้) · สวิตช์เดียวกันคุมการวิเคราะห์แชทรายชั่วโมง — อ่านบทสนทนา LINE แล้วอัปเดตคะแนน/ระดับความสนใจ + เติมข้อมูลที่ลูกค้าพูดถึง (รุ่น สี งบ ผ่อน/สด เทิร์น) เฉพาะช่องที่ยังว่าง ไม่ทับข้อมูลที่คนกรอก" },
  { key: "nudge", title: "Aira ร่างข้อความติดตามลูกค้า", desc: "ส่งร่างข้อความให้เซลส์ตอนเช้า — ตั้งเวลาทำงานได้" },
  { key: "digest", title: "Aira สรุปเช้า (ผจก.)", desc: "สรุปสถานะทีมส่ง LINE ผจก. ตอนเช้า — ตั้งเวลาทำงานได้" },
];

export default function AutomationSettingsPage() {
  const [config, setConfig] = useState<AutomationResponse | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState("");

  const load = () => {
    fetch("/api/settings/automation").then((r) => r.json()).then((c: AutomationResponse) => {
      setConfig(c);
      setLimitInput(c.lineQuota.monthlyLimit !== null ? String(c.lineQuota.monthlyLimit) : "");
    });
  };
  useEffect(load, []);

  async function save(key: "sla" | "score" | "nudge" | "digest", patch: Record<string, unknown>) {
    if (!config) return;
    setSaving(key);
    const body = { [key]: { ...config[key], ...patch } };
    const res = await fetch("/api/settings/automation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(null);
    if (data.config) { setConfig(data.config); setLimitInput(data.config.lineQuota.monthlyLimit !== null ? String(data.config.lineQuota.monthlyLimit) : ""); }
  }

  async function saveLineQuota(patch: Partial<AutomationResponse["lineQuota"]>) {
    if (!config) return;
    setSaving("lineQuota");
    const res = await fetch("/api/settings/automation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineQuota: patch }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(null);
    if (data.config) setConfig(data.config);
  }

  async function saveOwnerSwitch(patch: Partial<AutomationResponse["ownerSwitch"]>) {
    if (!config) return;
    setSaving("ownerSwitch");
    const res = await fetch("/api/settings/automation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerSwitch: patch }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(null);
    if (data.config) setConfig(data.config);
  }

  const usagePct = config?.lineQuota.monthlyLimit
    ? Math.min(100, Math.round((config.lineMessagesThisMonth / config.lineQuota.monthlyLimit) * 100))
    : null;

  return (
    <SettingsShell>
      <div>
        <h1 className="text-[1.5rem]">ระบบอัตโนมัติ</h1>
        <p className="text-[var(--text-2)] text-[.9rem]">
          ระบบมี scheduler ในตัว ทำงานทุกชั่วโมงอัตโนมัติ — หน้านี้ควบคุมว่างานแต่ละอย่าง &quot;ทำจริงหรือไม่&quot; และงานที่ทำวันละครั้งเลือกได้ว่าให้ทำงานตอนกี่โมง
        </p>
      </div>

      {config === null ? <p className="text-sm text-[var(--text-2)]">Loading…</p> : (
        <div className="space-y-3">
          {JOBS.map((j) => (
            <Card key={j.key} title={j.title} desc={j.desc}>
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Toggle on={config[j.key].enabled} onClick={() => save(j.key, { enabled: !config[j.key].enabled })} />
                  <span className="text-[.8rem] text-[var(--text-2)]">{config[j.key].enabled ? "เปิดใช้งาน" : "ปิดอยู่"}</span>
                </div>
                {!j.hourly && (
                  <label className="flex items-center gap-2 text-[.8rem] text-[var(--text-2)]">
                    เวลาทำงาน
                    <select
                      value={"hour" in config[j.key] ? (config[j.key] as { hour: number }).hour : 0}
                      onChange={(e) => save(j.key, { hour: Number(e.target.value) })}
                      className="px-2 py-1 bg-white border border-[var(--border-2)] rounded-lg text-[.8rem]">
                      {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                    </select>
                  </label>
                )}
                {saving === j.key && <Loader2 size={14} className="animate-spin text-[var(--text-3)]" />}
              </div>
            </Card>
          ))}

          <Card title="โควตาข้อความ LINE (ทักทายอัตโนมัติตอนลูกค้าแอด)"
            desc="แต่ละครั้งที่ระบบส่งข้อความทักทายผ่าน LINE จะกินโควตาข้อความของแพ็กเกจ — ปิดได้ถ้าไม่อยากเสียโควตา (ลูกค้ายังเห็นชื่อ+เบอร์เซลส์บนหน้าเว็บอยู่ดี ไม่เสียโควตา) หรือกำหนดเพดานต่อเดือนไว้กันโควตาหมดกลางเดือน">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Toggle on={config.lineQuota.welcomeEnabled} onClick={() => saveLineQuota({ welcomeEnabled: !config.lineQuota.welcomeEnabled })} />
                <span className="text-[.8rem] text-[var(--text-2)]">{config.lineQuota.welcomeEnabled ? "ส่งข้อความทักทายผ่าน LINE" : "ปิด — แสดงชื่อ/เบอร์บนหน้าเว็บอย่างเดียว"}</span>
              </div>
              <label className="flex items-center gap-2 text-[.8rem] text-[var(--text-2)]">
                เพดานต่อเดือน
                <input value={limitInput} onChange={(e) => setLimitInput(e.target.value)}
                  onBlur={() => saveLineQuota({ monthlyLimit: limitInput.trim() ? Number(limitInput) : null })}
                  inputMode="numeric" placeholder="ไม่จำกัด" className="w-24 px-2 py-1 bg-white border border-[var(--border-2)] rounded-lg text-[.8rem]" />
                ข้อความ
              </label>
              {saving === "lineQuota" && <Loader2 size={14} className="animate-spin text-[var(--text-3)]" />}
            </div>
            <div className="text-[.78rem] text-[var(--text-2)]">
              ใช้ไปแล้วเดือนนี้: <span className="font-medium num">{config.lineMessagesThisMonth}</span>
              {usagePct !== null && ` (${usagePct}% ของเพดาน ${config.lineQuota.monthlyLimit})`}
              {usagePct !== null && usagePct >= 100 && <span className="text-[var(--red)] font-medium"> — ถึงเพดานแล้ว ข้อความทักทายจะหยุดส่งอัตโนมัติ</span>}
            </div>
          </Card>

          <Card title="ยืนยันเปลี่ยนผู้ดูแล (ลูกค้าสแกน QR เซลส์คนใหม่)"
            desc="เมื่อลูกค้าที่มีเซลส์ดูแลอยู่แล้ว (ยี่ห้อเดิม) สแกน QR ของเซลส์อีกคน — เปิดไว้: ระบบจะถามลูกค้าทาง LINE ว่าจะอยู่กับเซลส์เดิมหรือเปลี่ยน (ไม่เปลี่ยนจนกว่าลูกค้าจะกดเลือกเอง) · ปิดไว้: ไม่ถามอะไร คงเซลส์เดิมไว้เงียบๆ แล้วส่งข้อความทักทายปกติ">
            <div className="flex items-center gap-2">
              <Toggle on={config.ownerSwitch.enabled} onClick={() => saveOwnerSwitch({ enabled: !config.ownerSwitch.enabled })} />
              <span className="text-[.8rem] text-[var(--text-2)]">{config.ownerSwitch.enabled ? "เปิด — ถามลูกค้าก่อนเปลี่ยน" : "ปิด — คงเซลส์เดิมไว้เงียบๆ ไม่ถาม"}</span>
              {saving === "ownerSwitch" && <Loader2 size={14} className="animate-spin text-[var(--text-3)]" />}
            </div>
            <p className="text-[.74rem] text-[var(--text-2)]">
              หมายเหตุ: ถ้าเซลส์เจ้าของเดิม<b>ถูกปิดใช้งาน</b>ไปแล้ว (ลาออก/ปิดบัญชี) ระบบจะย้าย Lead ให้เซลส์คนที่สแกน QR ใหม่ให้อัตโนมัติเสมอ ไม่ว่าตั้งค่านี้เปิดหรือปิด — กันลูกค้าติดอยู่กับเซลส์ที่ไม่มีใครดูแลแล้ว
            </p>
          </Card>
        </div>
      )}
    </SettingsShell>
  );
}
