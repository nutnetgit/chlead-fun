"use client";

// Public customer mini-form reached via a salesperson's QR. Customer fills
// only ชื่อ + เบอร์ + รุ่นที่สนใจ; everything else (owner/branch/brand/event)
// rides in the QR's query string and is re-validated server-side.
//
// This is now the NO-LINE fallback only (user req 2026-07-08) — QrLeadModal
// points here only when NEXT_PUBLIC_LIFF_ID isn't configured; otherwise it
// points at /liff/register (add-friend first, this same form second, both
// inside LINE, one request). Kept deliberately unchanged in spirit as the
// plain-web path for desktop scans / no LINE app installed.

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, ChevronDown } from "lucide-react";

type ModelRow = { modelId: number; modelName: string };

const PDPA_TEXT = `ยินยอมให้เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของคุณ ("ข้อมูล") ให้แก่เรา บริษัทในเครือ ช.เอราวัณ กรุ๊ป โดยเราอาจเปิดเผยข้อมูลส่วนบุคคลของคุณเท่าที่จำเป็นและเกี่ยวข้อง เพื่อวัตถุประสงค์ในการวิเคราะห์แนวโน้มการตัดสินใจซื้อรถยนต์ในเครือของบริษัทฯ

การนำเสนอผลิตภัณฑ์ รถยนต์ และ/หรือบริการอื่นๆ ที่เกี่ยวข้องกับรถยนต์ อาทิ บริการด้านสินเชื่อเพื่อการเช่าซื้อ รถยนต์ รวมถึงการนำเสนอโปรโมชั่น กิจกรรมส่งเสริมการขาย และสิทธิประโยชน์พิเศษอื่น ๆ ให้แก่คุณ`;

const TIMEFRAME_OPTIONS: { value: string; label: string }[] = [
  { value: "within_1m", label: "เร็วๆ นี้ (ภายในเดือนนี้)" },
  { value: "m1_3", label: "อีกไม่นาน (1-3 เดือน)" },
  { value: "m3_6", label: "ยังมีเวลา (3-6 เดือน)" },
  { value: "over_6m", label: "แค่ดูข้อมูลไว้ก่อน" },
];

function LeadForm() {
  const sp = useSearchParams();
  const ownerUserId = sp.get("u");
  const brandId = sp.get("b");
  const branchId = sp.get("br");
  const eventId = sp.get("e");

  const [models, setModels] = useState<ModelRow[]>([]);
  const [brandName, setBrandName] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineId, setLineId] = useState("");
  const [modelId, setModelId] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPdpa, setShowPdpa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!brandId) return;
    fetch(`/api/models?brandId=${brandId}`).then((r) => r.json()).then(setModels);
    fetch("/api/brands").then((r) => r.json()).then((bs: { brandId: number; brandName: string }[]) => {
      setBrandName(bs.find((b) => b.brandId === Number(brandId))?.brandName ?? "");
    });
  }, [brandId]);

  const linkOk = ownerUserId && brandId && branchId;

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 9) { setError("กรุณากรอกชื่อและเบอร์โทรให้ครบ"); return; }
    if (!consent) { setError("กรุณายืนยันความยินยอมก่อนส่งข้อมูล"); return; }
    setSaving(true); setError(null);
    const res = await fetch("/api/public/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, phone,
        lineId: lineId.trim() || undefined,
        modelId: modelId ? Number(modelId) : undefined,
        buyTimeframe: timeframe || undefined,
        ownerUserId: Number(ownerUserId), brandId: Number(brandId), branchId: Number(branchId),
        eventId: eventId ? Number(eventId) : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) setDone(true);
    else setError((await res.json().catch(() => ({}))).error ?? "ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่");
  }

  if (!linkOk) return <p className="text-center text-[var(--text-2)] py-16">ลิงก์ไม่สมบูรณ์ — กรุณาสแกน QR ใหม่อีกครั้ง</p>;

  if (done) return (
    <div className="text-center py-16 space-y-4">
      <CheckCircle2 size={56} className="mx-auto text-[var(--primary)]" />
      <h1 className="text-xl">ขอบคุณค่ะ 🙏</h1>
      <p className="text-[var(--text-2)] text-sm">รับข้อมูลเรียบร้อยแล้ว ที่ปรึกษาการขายจะติดต่อกลับโดยเร็วที่สุด</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="text-center pt-4">
        <div className="h-12 w-12 rounded-2xl bg-[var(--primary)] text-white flex items-center justify-center text-lg font-semibold mx-auto mb-3">{brandName.slice(0, 1) || "C"}</div>
        <h1 className="text-xl">ลงทะเบียนรับข้อมูล{brandName ? ` ${brandName}` : ""}</h1>
        <p className="text-[var(--text-2)] text-[.85rem] mt-1">กรอกสั้นๆ 3 ช่อง ที่ปรึกษาการขายจะติดต่อกลับค่ะ</p>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-5 space-y-4">
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">ชื่อ *</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 text-[.95rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="ชื่อ-นามสกุล หรือชื่อเล่น" />
        </label>
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">เบอร์โทร *</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
            className="w-full px-3.5 py-2.5 text-[.95rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="08x-xxx-xxxx" />
        </label>
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">LINE ID (ถ้ามี)</span>
          <input value={lineId} onChange={(e) => setLineId(e.target.value)}
            className="w-full px-3.5 py-2.5 text-[.95rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            placeholder="เช่น somchai123 — สะดวกให้ทักไลน์" />
        </label>
        <label className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-1">รุ่นที่สนใจ</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}
            className="w-full px-3.5 py-2.5 text-[.95rem] bg-white border border-[var(--border-2)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--primary)]">
            <option value="">— เลือกรุ่น —</option>
            {models.map((m) => <option key={m.modelId} value={m.modelId}>{m.modelName}</option>)}
          </select>
        </label>
        <div className="block">
          <span className="text-[.78rem] text-[var(--text-2)] block mb-2">คุณอยากได้รถคันใหม่เร็วแค่ไหน?</span>
          <div className="grid grid-cols-2 gap-2">
            {TIMEFRAME_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => setTimeframe(timeframe === o.value ? "" : o.value)}
                className={`text-[.78rem] px-3 py-2.5 rounded-xl border text-left transition ${
                  timeframe === o.value ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                                        : "bg-white border-[var(--border-2)] text-[var(--text-2)]"}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 pt-1 border-t border-[var(--border)]">
          <label className="flex items-start gap-2.5 pt-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--primary)] shrink-0" />
            <span className="text-[.78rem] text-[var(--text-2)] leading-snug">
              ลงทะเบียนและยินยอมให้ข้อมูล —{" "}
              <button type="button" onClick={() => setShowPdpa((v) => !v)} className="text-[var(--accent-text)] underline inline-flex items-center gap-0.5">
                อ่านเงื่อนไข <ChevronDown size={12} className={showPdpa ? "rotate-180 transition" : "transition"} />
              </button>
            </span>
          </label>
          {showPdpa && (
            <div className="bg-[var(--bg)] rounded-xl p-3.5 text-[.72rem] text-[var(--text-2)] leading-relaxed whitespace-pre-line">
              {PDPA_TEXT}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-[var(--red)]">❌ {error}</p>}
        <button onClick={submit} disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[.95rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : null} ส่งข้อมูล
        </button>
      </div>
    </div>
  );
}

export default function LeadFormPage() {
  return (
    <Suspense fallback={<p className="text-center py-16 text-[var(--text-2)]">กำลังโหลด…</p>}>
      <LeadForm />
    </Suspense>
  );
}
