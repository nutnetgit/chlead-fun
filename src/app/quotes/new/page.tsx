"use client";

// Quotation composer (user req 2026-07-11). One scrolling page — vehicle,
// price, options checklist, payment — with a sticky live-total bar pinned to
// the bottom; nothing is hidden behind steps, so a salesperson can fill it
// in any order while talking to the customer. Totals shown here are a
// preview only; the API recomputes them server-side on save.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, Check, Plus, X, FileText, Send, ArrowLeft, ExternalLink } from "lucide-react";
import { Card, inputCls } from "@/components/ui";

type LeadInfo = { leadId: number; customerName: string; fullName: string | null; phone: string | null; brand: string; brandId: number; branch: string };
type ModelRow = { modelId: number; modelName: string };
type OptionRow = { optionId: number; optionType: string; optionName: string; optionValue: number | null; isActive: boolean };
type PickedItem = { key: string; optionType: string; itemName: string; itemValue: string; isFree: boolean };

const GROUPS: { type: string; label: string }[] = [
  { type: "addon", label: "อุปกรณ์เสริม" },
  { type: "decor_exterior", label: "ตกแต่งภายนอก" },
  { type: "decor_interior", label: "ตกแต่งภายใน" },
  { type: "decor_electronics", label: "อิเล็กทรอนิกส์" },
  { type: "decor_other", label: "ชุดแต่ง / แพ็กเกจ" },
  { type: "reg_insurance", label: "ทะเบียน-ประกัน / วันรับรถ" },
  { type: "special_offer", label: "ข้อเสนอพิเศษ" },
];

const money = (n: number) => n.toLocaleString("th-TH");

function QuoteComposer() {
  const sp = useSearchParams();
  const router = useRouter();
  const leadId = sp.get("lead");

  const [lead, setLead] = useState<LeadInfo | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [options, setOptions] = useState<OptionRow[]>([]);

  const [modelId, setModelId] = useState("");
  const [variant, setVariant] = useState("");
  const [color, setColor] = useState("");
  const [listPrice, setListPrice] = useState("");
  const [colorAdj, setColorAdj] = useState("");
  const [discount, setDiscount] = useState("");
  const [deposit, setDeposit] = useState("");
  const [regFee, setRegFee] = useState("");
  const [compulsoryIns, setCompulsoryIns] = useState("");
  const [firstInstallment, setFirstInstallment] = useState("");
  const [paymentType, setPaymentType] = useState<"" | "cash" | "finance">("");
  const [validUntil, setValidUntil] = useState("");
  const [picked, setPicked] = useState<PickedItem[]>([]);
  const [customName, setCustomName] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ quoteId: number; quoteNo: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    if (!leadId) return;
    fetch(`/api/leads/${leadId}`).then((r) => r.json()).then((d: LeadInfo) => {
      setLead(d);
      if (d.brandId) fetch(`/api/models?brandId=${d.brandId}`).then((r) => r.json()).then(setModels);
    });
    fetch("/api/quote-options").then((r) => r.json()).then((rows: OptionRow[]) => setOptions(rows.filter((o) => o.isActive)));
  }, [leadId]);

  const toggleOption = (o: OptionRow) => {
    const key = `opt-${o.optionId}`;
    setPicked((cur) => cur.some((p) => p.key === key)
      ? cur.filter((p) => p.key !== key)
      : [...cur, { key, optionType: o.optionType, itemName: o.optionName, itemValue: o.optionValue !== null ? String(o.optionValue) : "", isFree: false }]);
  };
  const addCustom = () => {
    if (!customName.trim()) return;
    setPicked((cur) => [...cur, { key: `custom-${Date.now()}`, optionType: "other", itemName: customName.trim(), itemValue: "", isFree: false }]);
    setCustomName("");
  };
  const patchItem = (key: string, patch: Partial<PickedItem>) =>
    setPicked((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const totals = useMemo(() => {
    const lp = Number(listPrice) || 0;
    const adj = Number(colorAdj) || 0;
    const disc = Number(discount) || 0;
    const dep = Number(deposit) || 0;
    const reg = Number(regFee) || 0;
    const ins = Number(compulsoryIns) || 0;
    const inst = Number(firstInstallment) || 0;
    const paid = picked.reduce((s, p) => s + (p.isFree ? 0 : Number(p.itemValue) || 0), 0);
    const total = lp + adj - disc + paid + reg + ins + inst;
    return { total, balance: total - dep, paid };
  }, [listPrice, colorAdj, discount, deposit, regFee, compulsoryIns, firstInstallment, picked]);

  async function save() {
    if (!leadId) return;
    if (!(Number(listPrice) > 0)) { setError("กรุณากรอกราคารถ"); return; }
    setSaving(true); setError(null);
    const res = await fetch(`/api/leads/${leadId}/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: modelId ? Number(modelId) : undefined,
        variant: variant || undefined,
        color: color || undefined,
        listPrice: Number(listPrice),
        colorPriceAdjust: Number(colorAdj) || 0,
        discount: Number(discount) || 0,
        depositAmount: Number(deposit) || 0,
        registrationFee: Number(regFee) || 0,
        compulsoryInsurance: Number(compulsoryIns) || 0,
        firstInstallment: Number(firstInstallment) || 0,
        paymentType: paymentType || undefined,
        validUntil: validUntil || undefined,
        items: picked.map((p) => ({
          optionType: p.optionType, itemName: p.itemName,
          itemValue: p.itemValue.trim() ? Number(p.itemValue) : undefined, isFree: p.isFree,
        })),
      }),
    });
    setSaving(false);
    if (res.ok) setCreated(await res.json());
    else setError((await res.json().catch(() => ({}))).error ?? "บันทึกไม่สำเร็จ");
  }

  async function sendToCustomer() {
    if (!created) return;
    setSending(true); setError(null);
    const res = await fetch(`/api/quotes/${created.quoteId}/send`, { method: "POST" });
    setSending(false);
    if (res.ok) setSentOk(true);
    else setError((await res.json().catch(() => ({}))).error ?? "ส่งไม่สำเร็จ");
  }

  if (!leadId) return <p className="text-sm text-[var(--text-2)] py-10 text-center">ไม่พบ Lead — เปิดหน้านี้จากปุ่มในหน้าแชท</p>;

  if (created) {
    return (
      <div className="max-w-md mx-auto pt-12 text-center space-y-5">
        <div className="h-14 w-14 rounded-2xl bg-[var(--green-soft)] text-[var(--green)] flex items-center justify-center mx-auto"><Check size={26} /></div>
        <div>
          <h1 className="text-xl">บันทึกใบเสนอราคาแล้ว</h1>
          <p className="text-[var(--text-2)] text-[.9rem] mt-1">เลขที่ {created.quoteNo} · {lead?.customerName}</p>
        </div>
        {error && <p className="text-sm text-[var(--red)]">❌ {error}</p>}
        <div className="space-y-2.5 max-w-xs mx-auto">
          <button onClick={sendToCustomer} disabled={sending || sentOk}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[.95rem] font-medium bg-[var(--primary)] text-white hover:bg-[var(--accent-text)] disabled:opacity-60">
            {sending ? <Loader2 size={16} className="animate-spin" /> : sentOk ? <Check size={16} /> : <Send size={16} />}
            {sentOk ? "ส่งให้ลูกค้าแล้ว" : "ส่ง PDF ให้ลูกค้าทาง LINE"}
          </button>
          <a href={`/api/quotes/${created.quoteId}/pdf`} target="_blank" rel="noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[.95rem] border border-[var(--border-2)] bg-white hover:bg-[var(--surface-2)]">
            <ExternalLink size={15} /> เปิดดู PDF
          </a>
          <button onClick={() => router.push("/chat")}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[.95rem] text-[var(--text-2)] hover:bg-[var(--surface-2)]">
            <ArrowLeft size={15} /> กลับหน้าแชท
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-2)]"><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-[1.5rem] flex items-center gap-2"><FileText size={20} className="text-[var(--primary)]" /> ใบเสนอราคาใหม่</h1>
          <p className="text-[var(--text-2)] text-[.88rem]">{lead ? `${lead.fullName || lead.customerName} · ${lead.brand} ${lead.branch}` : "กำลังโหลด…"}</p>
        </div>
      </div>

      <Card title="รถยนต์และราคา">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รุ่นรถ</span>
            <select value={modelId} onChange={(e) => { setModelId(e.target.value); const m = models.find((x) => x.modelId === Number(e.target.value)); if (m && !variant) setVariant(m.modelName); }} className={inputCls}>
              <option value="">— เลือก —</option>
              {models.map((m) => <option key={m.modelId} value={m.modelId}>{m.modelName}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รุ่นย่อย / คำอธิบาย</span>
            <input value={variant} onChange={(e) => setVariant(e.target.value)} className={inputCls} placeholder="เช่น 1.3 ULTRA" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">สี</span>
            <input value={color} onChange={(e) => setColor(e.target.value)} className={inputCls} placeholder="เช่น ขาวมุก" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ราคารถ (บาท) *</span>
            <input value={listPrice} onChange={(e) => setListPrice(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ราคาสีพิเศษ (บาท)</span>
            <input value={colorAdj} onChange={(e) => setColorAdj(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ส่วนลด (บาท)</span>
            <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
        </div>
      </Card>

      <Card title="รายการประกอบ" desc="ติ๊กเลือกจากรายการที่ตั้งค่าไว้ แล้วกรอกมูลค่า/สลับ ซื้อ↔แถม ต่อรายการ">
        <div className="space-y-4">
          {GROUPS.map((g) => {
            const groupOptions = options.filter((o) => o.optionType === g.type);
            if (!groupOptions.length) return null;
            return (
              <div key={g.type}>
                <div className="text-[11px] font-semibold text-[var(--text-3)] uppercase tracking-wide mb-1.5">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {groupOptions.map((o) => {
                    const active = picked.some((p) => p.key === `opt-${o.optionId}`);
                    return (
                      <button key={o.optionId} type="button" onClick={() => toggleOption(o)}
                        className={`text-[.76rem] px-2.5 py-1 rounded-full border transition ${
                          active ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium"
                                 : "bg-white border-[var(--border-2)] text-[var(--text-2)] hover:border-[var(--text-3)]"}`}>
                        {o.optionName}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <input value={customName} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }}
              placeholder="รายการอื่นๆ นอกเหนือจากลิสต์ — พิมพ์แล้ว Enter" className={inputCls + " max-w-sm"} />
            <button onClick={addCustom} disabled={!customName.trim()}
              className="flex items-center gap-1 px-3 py-2 rounded-lg text-[.8rem] font-medium bg-[var(--primary)] text-white disabled:opacity-50"><Plus size={14} /> เพิ่ม</button>
          </div>
        </div>

        {picked.length > 0 && (
          <div className="mt-4 divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
            {picked.map((p) => (
              <div key={p.key} className="flex items-center gap-2.5 px-3 py-2 bg-white flex-wrap">
                <span className="text-[.82rem] flex-1 min-w-[140px]">{p.itemName}</span>
                <div className="flex gap-1 bg-[var(--bg)] p-0.5 rounded-full">
                  {(["ซื้อ", "แถม"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => patchItem(p.key, { isFree: mode === "แถม" })}
                      className={`text-[.7rem] px-2.5 py-0.5 rounded-full transition ${
                        (mode === "แถม") === p.isFree ? "bg-white font-semibold shadow-[var(--shadow)]" : "text-[var(--text-3)]"}`}>
                      {mode}
                    </button>
                  ))}
                </div>
                <input value={p.itemValue} onChange={(e) => patchItem(p.key, { itemValue: e.target.value })} inputMode="decimal"
                  placeholder={p.isFree ? "มูลค่า (โชว์ในเอกสาร)" : "ราคา (บาท)"}
                  className="w-36 px-2.5 py-1.5 text-[.8rem] bg-white border border-[var(--border-2)] rounded-lg text-right num" />
                <button onClick={() => setPicked((cur) => cur.filter((x) => x.key !== p.key))}
                  className="p-1 rounded text-[var(--text-3)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="การชำระเงิน">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">รูปแบบ</span>
            <div className="flex gap-2">
              {([["cash", "เงินสด"], ["finance", "ไฟแนนซ์"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setPaymentType(paymentType === v ? "" : v)}
                  className={`flex-1 py-2 rounded-lg text-[.82rem] border transition ${
                    paymentType === v ? "bg-[var(--accent-soft)] border-[var(--primary)] text-[var(--accent-text)] font-medium" : "bg-white border-[var(--border-2)]"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">เงินจอง (บาท)</span>
            <input value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ยืนราคาถึงวันที่</span>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className={inputCls} />
          </label>
        </div>
      </Card>

      <Card title="เงินที่ต้องเตรียมวันรับรถ" desc="แยกรายการนอกเหนือจากราคารถ — แสดงเป็นรายการย่อยในใบเสนอราคา">
        <div className="grid md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ค่าจดทะเบียน (บาท)</span>
            <input value={regFee} onChange={(e) => setRegFee(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ค่า พ.ร.บ. (บาท)</span>
            <input value={compulsoryIns} onChange={(e) => setCompulsoryIns(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-[var(--text-2)] mb-1 block">ค่างวดแรก ณ วันรับรถ (บาท)</span>
            <input value={firstInstallment} onChange={(e) => setFirstInstallment(e.target.value)} inputMode="decimal" className={inputCls + " num"} placeholder="0" />
          </label>
        </div>
      </Card>

      {/* sticky live total */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-[var(--border)] px-4 py-3">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-4 flex-wrap">
            <div><span className="text-[11px] text-[var(--text-3)] mr-1.5">ยอดสุทธิ</span><b className="num text-xl text-[var(--accent-text)]">{money(totals.total)}</b><span className="text-[11px] text-[var(--text-3)] ml-1">บาท</span></div>
            {Number(deposit) > 0 && <div className="text-[.8rem] text-[var(--text-2)]">คงเหลือวันรับรถ <b className="num">{money(totals.balance)}</b></div>}
            {error && <span className="text-[.78rem] text-[var(--red)]">❌ {error}</span>}
          </div>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-[var(--primary)] text-white hover:brightness-95 disabled:opacity-50">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} บันทึกใบเสนอราคา
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NewQuotePage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--text-2)] py-10 text-center">กำลังโหลด…</p>}>
      <QuoteComposer />
    </Suspense>
  );
}
