import path from "path";
import React from "react";
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";

/**
 * Quotation PDF (user req 2026-07-11, restyled 2026-07-13 to a numbered-
 * section table layout — own wording/data throughout, structural pattern
 * per the user's own design brief, not any single source's exact text).
 * Thai text needs an embedded Thai font — Noto Sans Thai (OFL-licensed)
 * ships in public/fonts and is registered below; without it every Thai
 * glyph renders as tofu boxes.
 *
 * Two hard-won Thai rendering rules for this renderer (verified 2026-07-11
 * by rendering test PDFs — regressions are visual-only, no error thrown):
 *  1. Never use letterSpacing on Thai text (see the style comment below).
 *  2. Route ALL text through <T>, not <Text>, for the ำ fix (see fixThai).
 */
const fontDir = path.join(process.cwd(), "public", "fonts");
Font.register({
  family: "ThaiSans",
  fonts: [
    { src: path.join(fontDir, "NotoSansThai-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fontDir, "NotoSansThai-Bold.ttf"), fontWeight: 700 },
  ],
});

// SARA AM (ำ, U+0E33) trips a width-measurement bug in this renderer: the
// shaper splits it into NIKHAHIT + SARA AA (two glyphs) but the measurer
// counts one, so lines containing ำ get their last glyph clipped. Feeding
// the decomposed pair (U+0E4D U+0E32) in makes measurement match shaping.
const fixThai = (v: string) => v.replace(/ำ/g, "ํา");
type TextStyle = ReturnType<typeof StyleSheet.create>[string];
function T({ style, children }: { style?: TextStyle | TextStyle[]; children?: React.ReactNode }) {
  const mapped = React.Children.map(children, (c) => (typeof c === "string" ? fixThai(c) : c));
  return <Text style={style}>{mapped}</Text>;
}

export type QuotePdfData = {
  quoteNo: string;
  createdAt: Date | null;
  validUntil: Date | null;
  companyName: string;
  companyAddress: string | null;
  brandName: string;
  branchName: string;
  customerName: string;
  customerPhone: string | null;
  variant: string | null;
  color: string | null;
  modelCode: string | null;
  listPrice: number;
  colorPriceAdjust: number;
  discount: number;
  depositAmount: number;
  registrationFee: number;
  compulsoryInsurance: number;
  firstInstallment: number;
  paymentType: string | null;
  items: { itemName: string; optionType: string; itemValue: number | null; isFree: boolean }[];
  accessoriesValue: number;
  totalPrice: number;
  salesName: string;
  salesPhone: string | null;
};

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const fmtThaiDate = (d: Date | null) => d ? `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}` : "-";
const baht = (n: number) => `${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Bilingual labels — Thai (English) on one line, own wording throughout.
const L = {
  docTitle: "รายละเอียดข้อเสนอการขาย (Vehicle Quotation & Special Offer)",
  docNo: "เลขที่เอกสาร (Doc No.)",
  issueDate: "วันที่ (Date)",
  validUntil: "ยืนราคาถึง (Valid Until)",
  sec1: "1. รายละเอียดลูกค้า และที่ปรึกษาการขาย (Customer & Sales Consultant Details)",
  customerInfo: "รายละเอียดลูกค้า (Customer Details)",
  custName: "ชื่อลูกค้า (Customer Name)",
  phone: "เบอร์โทรศัพท์ (Tel.)",
  consultantInfo: "ที่ปรึกษาการขาย (Sales Consultant)",
  consultName: "ชื่อ-นามสกุล (Name)",
  sec2: "2. รายละเอียดรถยนต์ (Vehicle Details)",
  model: "รุ่นรถยนต์ (Model)",
  grade: "รุ่นย่อย / รหัสรุ่น (Grade / Model Code)",
  colorCol: "สีรถยนต์ (Color)",
  netVehiclePrice: "ราคารถยนต์ สุทธิ (Vehicle Net Price)",
  sec3: "3. รายการข้อเสนอพิเศษ (Exclusive Offer)",
  no: "ลำดับ",
  offerItem: "รายการข้อเสนอพิเศษ (Offer Item)",
  offerType: "ประเภท (Type)",
  offerValue: "มูลค่า / บาท (Value / THB)",
  freeTag: "แถม (Free)",
  purchaseTag: "ซื้อเพิ่ม (Purchase)",
  sec4: "4. รายละเอียดเงื่อนไขการซื้อ (Financing / Cash Details)",
  detail: "รายละเอียด (Detail)",
  amountBaht: "จำนวนเงิน / บาท (Amount / THB)",
  carPriceVat: "ราคารถยนต์ (รวมภาษีมูลค่าเพิ่ม) (Vehicle Price, incl. VAT)",
  colorPrice: "ราคาสีพิเศษ (Premium Color)",
  discountRow: "ส่วนลด (Discount)",
  netPriceType: "ราคาสุทธิ (Net Price)",
  cash: "เงินสด (Cash)",
  finance: "เช่าซื้อ / ไฟแนนซ์ (Finance)",
  unspecified: "ยังไม่ระบุ (Unspecified)",
  sec5: "5. จำนวนเงินที่ต้องจัดเตรียมวันรับรถ (Payment Due at Delivery)",
  expenseDetail: "รายละเอียดค่าใช้จ่าย (Expense Detail)",
  netPriceDeduct: "ราคารถยนต์ (หักส่วนลด) (Net Price)",
  depositRow: "เงินดาวน์ / เงินจอง (Down Payment / Deposit)",
  regFee: "ค่าจดทะเบียน (Registration Fee)",
  insurance: "ค่า พ.ร.บ. (Compulsory Insurance)",
  firstInstallment: "ค่างวดแรก ณ วันรับรถ (1st Installment at Delivery)",
  accessories: "อุปกรณ์ตกแต่งที่ซื้อเพิ่ม (Accessories Purchased)",
  totalExpense: "รวมยอดที่ต้องชำระทั้งหมด (Total Expense)",
  deductDeposit: "หักเงินจอง (Deduct Deposit)",
  netTotalExpense: "รวมยอดที่ต้องชำระสุทธิ (Net Total Expense)",
  disclaimerNote: "หมายเหตุ (Note):",
};

// Dark/light navy blue (user req 2026-07-13, switched from the app's teal).
const ACCENT = "#1c3e6e";
const ACCENT_SOFT = "#e6ecf6";
const INK = "#1c2733";
const MUTED = "#606c7a";
const LINE = "#d7dfe9";
const GREEN = "#1c7a4a";
const AMBER = "#a05c14";
const DUE = "#b23b2e";

const s = StyleSheet.create({
  page: { fontFamily: "ThaiSans", fontSize: 8.5, color: INK, padding: 32, paddingBottom: 40 },

  headTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  branchName: { fontSize: 17, fontWeight: 700, color: INK },
  brandLine: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  docTitleBox: { maxWidth: 340 },
  docTitle: { fontSize: 10.5, fontWeight: 700, color: ACCENT, textAlign: "right" },

  metaRow: { flexDirection: "row", gap: 18, marginTop: 6 },
  metaLabel: { fontSize: 6.8, color: MUTED },
  metaValue: { fontSize: 8.8, fontWeight: 700, color: INK, marginTop: 1 },

  dealerBlock: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: INK },
  coName: { fontSize: 9.5, fontWeight: 700 },
  coSub: { fontSize: 7.8, color: MUTED, marginTop: 2 },

  // Numbered section header — solid accent bar, own identity color.
  sectionBar: { backgroundColor: ACCENT, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5, marginTop: 14, marginBottom: 8 },
  sectionText: { color: "#ffffff", fontSize: 8.3, fontWeight: 700 },

  twoCol: { flexDirection: "row", gap: 16 },
  colHead: { fontSize: 7.6, fontWeight: 700, color: ACCENT, marginBottom: 5 },
  kvRow: { flexDirection: "row", paddingVertical: 2 },
  kLabel: { flex: 1.3, color: MUTED, fontSize: 8 },
  kVal: { flex: 1.6, fontWeight: 700, fontSize: 8.3 },

  // No letterSpacing on Thai text — it desyncs this renderer's width
  // measurement from the shaped glyphs and clips edge characters.
  table: { borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  th: { flexDirection: "row", backgroundColor: ACCENT_SOFT, paddingHorizontal: 10, paddingVertical: 5.5 },
  thText: { fontSize: 7, color: ACCENT, fontWeight: 700 },
  row: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 5.5, borderTopWidth: 0.6, borderTopColor: LINE, alignItems: "center" },
  rowBold: { fontWeight: 700 },

  cNo: { flex: 0.9 },
  cName: { flex: 5 },
  cType: { flex: 1.6 },
  cVal: { flex: 1.8, textAlign: "right" },
  tagFree: { fontSize: 7.6, fontWeight: 700, color: GREEN },
  tagPaid: { fontSize: 7.6, fontWeight: 700, color: AMBER },

  vRow4: { flexDirection: "row" },
  vCol4: { flex: 1 },

  totalLabel: { flex: 3 },
  totalVal: { flex: 1.8, textAlign: "right" },
  duePriceRow: { backgroundColor: ACCENT_SOFT },
  dueText: { color: DUE },

  pageNo: { position: "absolute", bottom: 10, right: 32, fontSize: 7, color: MUTED },
  noteBox: { borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, marginTop: 16 },
  noteLabel: { fontSize: 7, fontWeight: 700, color: INK, marginBottom: 2 },
  noteText: { fontSize: 6.8, color: MUTED, lineHeight: 1.4 },
});

function QuoteDoc({ d }: { d: QuotePdfData }) {
  const paidItems = d.items.filter((i) => !i.isFree);
  const freeItems = d.items.filter((i) => i.isFree);
  const netCar = d.listPrice + d.colorPriceAdjust - d.discount;
  const totalExpense = netCar + d.accessoriesValue + d.registrationFee + d.compulsoryInsurance + d.firstInstallment;
  const netTotalExpense = totalExpense - d.depositAmount;

  const paymentLabel = d.paymentType === "cash" ? L.cash : d.paymentType === "finance" ? L.finance : L.unspecified;

  const disclaimer =
    `เอกสารฉบับนี้เป็นบันทึกข้อตกลงเบื้องต้น โดยบริษัทฯ ยินดีรับรองเงื่อนไขและสิทธิประโยชน์พิเศษดังกล่าวให้แก่ท่านจนถึงวันที่ ${fmtThaiDate(d.validUntil)} ` +
    `เมื่อท่านเสร็จสิ้นการลงนามสั่งจองและวางเงินมัดจำ ทางบริษัทฯ จะดำเนินการออกเอกสารใบสั่งจองรถยนต์หรือใบเสร็จรับเงินเพื่อเป็นหลักฐานที่ถูกต้องให้แก่ท่านต่อไป\n` +
    `This document records a preliminary agreement. The company will honor the above terms and special benefits until ${fmtThaiDate(d.validUntil)}. ` +
    `Once you have signed the booking and paid the deposit, the company will issue a vehicle booking form or receipt as formal proof.`;

  let itemNo = 0;
  const offerRows = [
    ...(d.colorPriceAdjust !== 0
      ? [{ name: "ราคาสีพิเศษ (Premium Color)", isFree: false, value: d.colorPriceAdjust }]
      : []),
    ...paidItems.map((it) => ({ name: it.itemName, isFree: false, value: it.itemValue })),
    ...freeItems.map((it) => ({ name: it.itemName, isFree: true, value: it.itemValue })),
  ];

  return (
    <Document title={`ใบเสนอราคา ${d.quoteNo}`} author={d.companyName}>
      <Page size="A4" style={s.page}>
        <View style={s.headTop}>
          <View>
            <T style={s.branchName}>{d.branchName}</T>
            <T style={s.brandLine}>{d.brandName}</T>
          </View>
          <View style={s.docTitleBox}>
            <T style={s.docTitle}>{L.docTitle}</T>
          </View>
        </View>

        <View style={s.metaRow}>
          <View><T style={s.metaLabel}>{L.docNo}</T><T style={s.metaValue}>{d.quoteNo}</T></View>
          <View><T style={s.metaLabel}>{L.issueDate}</T><T style={s.metaValue}>{fmtThaiDate(d.createdAt)}</T></View>
          <View><T style={s.metaLabel}>{L.validUntil}</T><T style={s.metaValue}>{fmtThaiDate(d.validUntil)}</T></View>
        </View>

        <View style={s.dealerBlock}>
          <T style={s.coName}>{d.companyName}</T>
          {d.companyAddress ? <T style={s.coSub}>{d.companyAddress}</T> : null}
        </View>

        <View wrap={false}>
          <View style={s.sectionBar}><T style={s.sectionText}>{L.sec1}</T></View>
          <View style={s.twoCol}>
            <View style={{ flex: 1 }}>
              <T style={s.colHead}>{L.customerInfo}</T>
              <View style={s.kvRow}><T style={s.kLabel}>{L.custName}</T><T style={s.kVal}>{d.customerName}</T></View>
              {d.customerPhone && <View style={s.kvRow}><T style={s.kLabel}>{L.phone}</T><T style={s.kVal}>{d.customerPhone}</T></View>}
            </View>
            <View style={{ flex: 1 }}>
              <T style={s.colHead}>{L.consultantInfo}</T>
              <View style={s.kvRow}><T style={s.kLabel}>{L.consultName}</T><T style={s.kVal}>{d.salesName}</T></View>
              {d.salesPhone && <View style={s.kvRow}><T style={s.kLabel}>{L.phone}</T><T style={s.kVal}>{d.salesPhone}</T></View>}
            </View>
          </View>
        </View>

        <View wrap={false}>
          <View style={s.sectionBar}><T style={s.sectionText}>{L.sec2}</T></View>
          <View style={s.table}>
            <View style={s.th}>
              <T style={[s.thText, s.vCol4]}>{L.model}</T>
              <T style={[s.thText, s.vCol4]}>{L.grade}</T>
              <T style={[s.thText, s.vCol4]}>{L.colorCol}</T>
              <T style={[s.thText, s.vCol4, { textAlign: "right" }]}>{L.netVehiclePrice}</T>
            </View>
            <View style={[s.row, s.vRow4]}>
              <T style={s.vCol4}>{d.variant ?? "-"}</T>
              <T style={s.vCol4}>{d.modelCode ?? "-"}</T>
              <T style={s.vCol4}>{d.color ?? "-"}</T>
              <T style={[s.vCol4, { textAlign: "right", fontWeight: 700 }]}>{baht(netCar)}</T>
            </View>
          </View>
        </View>

        {offerRows.length > 0 && (
          <View wrap={false}>
            <View style={s.sectionBar}><T style={s.sectionText}>{L.sec3}</T></View>
            <View style={s.table}>
              <View style={s.th}>
                <T style={[s.thText, s.cNo]}>{L.no}</T>
                <T style={[s.thText, s.cName]}>{L.offerItem}</T>
                <T style={[s.thText, s.cType]}>{L.offerType}</T>
                <T style={[s.thText, s.cVal]}>{L.offerValue}</T>
              </View>
              {offerRows.map((r, i) => {
                itemNo += 1;
                return (
                  <View key={i} style={s.row}>
                    <T style={s.cNo}>{itemNo}</T>
                    <T style={s.cName}>{r.name}</T>
                    <T style={[r.isFree ? s.tagFree : s.tagPaid, s.cType]}>{r.isFree ? L.freeTag : L.purchaseTag}</T>
                    <T style={s.cVal}>{r.value !== null && r.value !== 0 ? baht(r.value) : "-"}</T>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View wrap={false}>
          <View style={s.sectionBar}><T style={s.sectionText}>{L.sec4}</T></View>
          <View style={s.table}>
            <View style={s.th}>
              <T style={[s.thText, s.totalLabel]}>{L.detail}</T>
              <T style={[s.thText, s.totalVal]}>{L.amountBaht}</T>
            </View>
            <View style={s.row}><T style={s.totalLabel}>{L.carPriceVat}</T><T style={s.totalVal}>{baht(d.listPrice)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.colorPrice}</T><T style={s.totalVal}>{baht(d.colorPriceAdjust)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.discountRow}</T><T style={s.totalVal}>{baht(d.discount)}</T></View>
            <View style={[s.row, s.duePriceRow]}>
              <T style={[s.totalLabel, s.rowBold]}>{L.netPriceType} — {paymentLabel}</T>
              <T style={[s.totalVal, s.rowBold]}>{baht(netCar)}</T>
            </View>
          </View>
        </View>

        <View wrap={false}>
          <View style={s.sectionBar}><T style={s.sectionText}>{L.sec5}</T></View>
          <View style={s.table}>
            <View style={s.th}>
              <T style={[s.thText, s.totalLabel]}>{L.expenseDetail}</T>
              <T style={[s.thText, s.totalVal]}>{L.amountBaht}</T>
            </View>
            <View style={s.row}><T style={s.totalLabel}>{L.netPriceDeduct}</T><T style={s.totalVal}>{baht(netCar)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.depositRow}</T><T style={s.totalVal}>{baht(d.depositAmount)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.regFee}</T><T style={s.totalVal}>{baht(d.registrationFee)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.insurance}</T><T style={s.totalVal}>{baht(d.compulsoryInsurance)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.firstInstallment}</T><T style={s.totalVal}>{baht(d.firstInstallment)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.accessories}</T><T style={s.totalVal}>{baht(d.accessoriesValue)}</T></View>
            <View style={[s.row, s.rowBold]}><T style={[s.totalLabel, s.rowBold]}>{L.totalExpense}</T><T style={[s.totalVal, s.rowBold]}>{baht(totalExpense)}</T></View>
            <View style={s.row}><T style={s.totalLabel}>{L.deductDeposit}</T><T style={s.totalVal}>{d.depositAmount > 0 ? `-${baht(d.depositAmount)}` : baht(0)}</T></View>
            <View style={[s.row, s.duePriceRow]}>
              <T style={[s.totalLabel, s.rowBold, s.dueText]}>{L.netTotalExpense}</T>
              <T style={[s.totalVal, s.rowBold, s.dueText]}>{baht(netTotalExpense)}</T>
            </View>
          </View>
        </View>

        {/* Plain flowing content (not fixed/absolute) so it lands once,
            naturally, wherever the last section ends up — user req
            2026-07-13: the note must appear only on the final page, which a
            `fixed` footer (repeated on every page) can't do. */}
        <View style={s.noteBox}>
          <T style={s.noteLabel}>{L.disclaimerNote}</T>
          <T style={s.noteText}>{disclaimer}</T>
        </View>

        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}

export async function buildQuotePdf(d: QuotePdfData): Promise<Buffer> {
  return renderToBuffer(<QuoteDoc d={d} />);
}
