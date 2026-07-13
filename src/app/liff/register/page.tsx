"use client";

// LIFF-first customer registration (user req 2026-07-08, add-friend-first
// order): scan QR → LIFF opens → LINE's "Bot link feature: Aggressive" (set
// in LINE Developers Console) prompts add-friend automatically → THIS page
// then shows the same form /lead-form has → one submit creates the lead AND
// links the verified LINE userId in a single request. Replaces the old
// two-step flow (/lead-form → separate /liff/welcome add-friend button) that
// let a customer submit and never become a LINE friend at all.
//
// Falls back to /lead-form when LIFF isn't reachable (no LINE app, desktop
// scan) — QrLeadModal only points here when a LIFF id is available.
//
// Per-brand LIFF (user req 2026-07-11): each brand can have its own LINE
// Login channel + LIFF app (linked 1:1 to that brand's Messaging channel, so
// the userId this page captures is push-able via that brand's OA token).
// The LIFF id is resolved from /api/brands (falls back to the legacy shared
// NEXT_PUBLIC_LIFF_ID for any brand not yet migrated) rather than read
// directly from an env var — see src/lib/lineConfig.ts.
//
// Declared as `any` for the LIFF SDK global — loaded from LINE's own CDN
// script tag (no npm types package needed for this single call surface).

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, CheckCircle2, ChevronDown, XCircle, Phone } from "lucide-react";

declare global {
  interface Window {
    liff?: {
      init: (o: { liffId: string }) => Promise<void>;
      getProfile: () => Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
    };
  }
}

type ModelRow = { modelId: number; modelName: string };

const PDPA_TEXT = `ยินยอมให้เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของคุณ ("ข้อมูล") ให้แก่เรา บริษัทในเครือ ช.เอราวัณ กรุ๊ป โดยเราอาจเปิดเผยข้อมูลส่วนบุคคลของคุณเท่าที่จำเป็นและเกี่ยวข้อง เพื่อวัตถุประสงค์ในการวิเคราะห์แนวโน้มการตัดสินใจซื้อรถยนต์ในเครือของบริษัทฯ

การนำเสนอผลิตภัณฑ์ รถยนต์ และ/หรือบริการอื่นๆ ที่เกี่ยวข้องกับรถยนต์ อาทิ บริการด้านสินเชื่อเพื่อการเช่าซื้อ รถยนต์ รวมถึงการนำเสนอโปรโมชั่น กิจกรรมส่งเสริมการขาย และสิทธิประโยชน์พิเศษอื่น ๆ ให้แก่คุณ`;

const TIMEFRAME_OPTIONS: { value: string; label: string }[] = [
  { value: "within_1m", label: "เร็วๆ นี้ (ภายในเดือนนี้)" },
  { value: "m1_3", label: "อีกไม่นาน (1-3 เดือน)" },
  { value: "m3_6", label: "ยังมีเวลา (3-6 เดือน)" },
  { value: "over_6m", label: "แค่ดูข้อมูลไว้ก่อน" },
];

type LiffState = "loading" | "ready" | "error";

function Register() {
  const spDirect = useSearchParams();
  // LINE wraps the original query string into a nested liff.state param
  // during the LIFF hand-off redirect (confirmed via live test 2026-07-10):
  // ?u=19&b=4 arrives here as ?liff.state=%3Fu%3D19%26b%3D4, NOT auto-
  // expanded into top-level params. Unwrap RECURSIVELY — QR codes printed
  // while the link generator briefly added its own liff.state wrapper arrive
  // double-nested (liff.state=?liff.state=?u=...), and LINE's own wrapping
  // could stack again on top of those.
  let sp: URLSearchParams = spDirect as unknown as URLSearchParams;
  for (let i = 0; i < 5; i++) {
    const nested = sp.get("liff.state");
    if (!nested) break;
    sp = new URLSearchParams(nested.replace(/^\?/, ""));
  }
  const ownerUserId = sp.get("u");
  const brandId = sp.get("b");
  const branchId = sp.get("br");
  const eventId = sp.get("e");

  const [liffState, setLiffState] = useState<LiffState>("loading");
  const [liffError, setLiffError] = useState("");
  const [lineUserId, setLineUserId] = useState("");

  const [models, setModels] = useState<ModelRow[]>([]);
  const [brandName, setBrandName] = useState<string>("");
  // Per-brand LIFF app id (user req 2026-07-11) — null until the /api/brands
  // fetch below resolves; falls back to the legacy shared app for any brand
  // not yet migrated to its own Login channel + LIFF app.
  const [liffId, setLiffId] = useState<string | null | undefined>(undefined);
  const [pictureUrl, setPictureUrl] = useState<string | null>(null);
  // The verified LINE profile name (user req 2026-07-13: whatever's typed
  // into the editable field below must never override this — /chat and the
  // lead cards always show the real LINE display name, not a retyped or
  // "corrected" version).
  const [lineDisplayName, setLineDisplayName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [modelId, setModelId] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [consent, setConsent] = useState(false);
  const [showPdpa, setShowPdpa] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ salesName: string; salesPhone: string | null; showroomLabel?: string; pushed: boolean; ownerSwitchPending?: boolean } | null>(null);

  const linkOk = ownerUserId && brandId && branchId;

  useEffect(() => {
    // liffId === undefined means the /api/brands fetch below hasn't resolved
    // yet — wait for it rather than treating "no id yet" as an error.
    if (liffId === undefined) return;
    if (!linkOk || !liffId) { setLiffState("error"); setLiffError("ลิงก์ไม่สมบูรณ์"); return; }
    const script = document.createElement("script");
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    script.async = true;
    script.onload = async () => {
      try {
        await window.liff!.init({ liffId });
        const profile = await window.liff!.getProfile();
        setLineUserId(profile.userId);
        setLineDisplayName(profile.displayName ?? "");
        setName((n) => n || profile.displayName || "");
        setPictureUrl(profile.pictureUrl ?? null);
        setLiffState("ready");
      } catch (e) {
        setLiffState("error"); setLiffError(String(e).slice(0, 100));
      }
    };
    script.onerror = () => { setLiffState("error"); setLiffError("โหลด LINE SDK ไม่สำเร็จ"); };
    document.body.appendChild(script);
  }, [linkOk, liffId]);

  useEffect(() => {
    if (!brandId) return;
    fetch(`/api/models?brandId=${brandId}`).then((r) => r.json()).then(setModels);
    fetch("/api/brands").then((r) => r.json()).then((bs: { brandId: number; brandName: string; liffId: string | null }[]) => {
      const b = bs.find((x) => x.brandId === Number(brandId));
      setBrandName(b?.brandName ?? "");
      setLiffId(b?.liffId || process.env.NEXT_PUBLIC_LIFF_ID || null);
    });
  }, [brandId]);

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 9) { setError("กรุณากรอกชื่อและเบอร์โทรให้ครบ"); return; }
    if (!consent) { setError("กรุณายืนยันความยินยอมก่อนส่งข้อมูล"); return; }
    setSaving(true); setError(null);
    const res = await fetch("/api/public/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, phone, lineUserId, pictureUrl: pictureUrl || undefined,
        lineDisplayName: lineDisplayName || undefined,
        modelId: modelId ? Number(modelId) : undefined,
        buyTimeframe: timeframe || undefined,
        ownerUserId: Number(ownerUserId), brandId: Number(brandId), branchId: Number(branchId),
        eventId: eventId ? Number(eventId) : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) { setResult(await res.json().catch(() => ({}))); setDone(true); }
    else setError((await res.json().catch(() => ({}))).error ?? "ส่งข้อมูลไม่สำเร็จ กรุณาลองใหม่");
  }

  if (!linkOk) {
    return <p className="text-center text-[var(--text-2)] py-16">ลิงก์ไม่สมบูรณ์ — กรุณาสแกน QR ใหม่อีกครั้ง</p>;
  }

  if (liffState === "loading") return (
    <div className="text-center py-16 space-y-3">
      <Loader2 size={40} className="mx-auto animate-spin text-[var(--primary)]" />
      <p className="text-[var(--text-2)] text-sm">กำลังเชื่อมต่อ…</p>
    </div>
  );
  if (liffState === "error") return (
    <div className="text-center py-16 space-y-3">
      <XCircle size={48} className="mx-auto text-[var(--red)]" />
      <p className="text-[var(--text-2)] text-sm">{liffError}</p>
    </div>
  );

  if (done) return (
    <div className="text-center py-16 space-y-4">
      <CheckCircle2 size={56} className="mx-auto text-[var(--primary)]" />
      <h1 className="text-xl">ขอบคุณค่ะ 🙏</h1>
      {result?.ownerSwitchPending ? (
        <p className="text-[var(--text-2)] text-sm px-6">เช็คข้อความในไลน์นี้นะคะ — เรามีคำถามสั้นๆ ให้ยืนยันว่าจะให้ที่ปรึกษาการขายท่านใดดูแลต่อค่ะ</p>
      ) : result?.pushed ? (
        <p className="text-[var(--text-2)] text-sm">รับข้อมูลเรียบร้อยแล้ว เซลล์จะทักหาในไลน์นี้ค่ะ</p>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-2xl shadow-[var(--shadow)] p-5 max-w-xs mx-auto text-left space-y-1.5">
          <p className="text-[.82rem] text-[var(--text-2)]">ที่ปรึกษาการขายที่ดูแลคุณค่ะ</p>
          <p className="text-base font-semibold">{result?.salesName}</p>
          {result?.showroomLabel && <p className="text-[.8rem] text-[var(--text-2)]">โชว์รูม {result.showroomLabel}</p>}
          {result?.salesPhone && (
            <a href={`tel:${result.salesPhone}`} className="flex items-center gap-1.5 text-[.9rem] text-[var(--accent-text)]">
              <Phone size={14} /> {result.salesPhone}
            </a>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="text-center pt-4">
        <div className="h-12 w-12 rounded-2xl bg-[var(--primary)] text-white flex items-center justify-center text-lg font-semibold mx-auto mb-3">{brandName.slice(0, 1) || "C"}</div>
        <h1 className="text-xl">ลงทะเบียนรับข้อมูล{brandName ? ` ${brandName}` : ""}</h1>
        <p className="text-[var(--text-2)] text-[.85rem] mt-1">เพิ่มเพื่อนเรียบร้อยแล้วค่ะ กรอกสั้นๆ อีกนิด ที่ปรึกษาการขายจะติดต่อกลับค่ะ</p>
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

export default function LiffRegisterPage() {
  return (
    <Suspense fallback={<p className="text-center py-16 text-[var(--text-2)]">กำลังโหลด…</p>}>
      <Register />
    </Suspense>
  );
}
