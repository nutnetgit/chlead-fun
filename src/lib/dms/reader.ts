import mysql from "mysql2/promise";

/**
 * Read-only reader for the SPS (legacy DMS) MySQL database — the vehicle
 * catalogue only (user req 2026-09-10: "เมื่อมีการเพิ่มรุ่นรถของยี่ห้อนั้น
 * หรือปรับสีนั้นๆ ให้นำมาแสดง"). Same approach the CPT/Insurance project
 * already uses for DMS reads, so IT only has to hand out one read-only
 * account for both systems.
 *
 * กฎเหล็ก: SELECT อย่างเดียว — ห้ามมี INSERT/UPDATE/DELETE ในไฟล์นี้.
 * SPS ยังไม่มี API สำหรับรุ่น/สี (มีแต่ autocomplete ที่คืน HTML และไม่ตรวจสิทธิ์)
 * จึงอ่านจากฐานข้อมูลตรงๆ แบบอ่านอย่างเดียว
 *
 * Catalogue shape on the SPS side (adam_prod):
 *   stock_brand        22 rows   sto_br_id, sto_br_desc
 *   stock_model_main   55 rows   nameplate: sto_mo_ma_id, sto_mo_ma_desc, sto_mo_ma_name_th, sto_br_id
 *   stock_model     1,484 rows   VARIANT + price, joined to the nameplate by NAME (sto_mo_name)
 *   stock_color       500 rows   colour per (sto_mo_name, sto_br_id) — i.e. per nameplate, not per brand
 *   stock_model_color         which colour is orderable on which variant, + colour surcharge
 * We mirror the two levels Lead FUN already has: nameplate → colour. Variants
 * and prices are deliberately NOT imported (user decision 2026-09-10).
 *
 * `st_id` is SPS's active flag, not a store id: 1/3 = ใช้งานอยู่, 2/4 = เลิกใช้.
 * stock_model_main has no such flag, so a nameplate counts as active when it
 * still has at least one active variant — the same rule SPS's own dropdowns
 * use (pros_form_autocomplete_modelmain.php).
 */

export type DmsNameplate = { dmsModelId: number; name: string; nameTh: string | null; isActive: boolean };
export type DmsColor = { dmsColorId: number; code: string | null; name: string; nameplate: string; isActive: boolean };

export const dmsConfigured = () => !!process.env.DMS_MYSQL_URL;

let pool: mysql.Pool | null = null;
function getPool(): mysql.Pool {
  const url = process.env.DMS_MYSQL_URL;
  if (!url) throw new Error("DMS_MYSQL_URL is not set");
  // Small pool: this runs a handful of SELECTs once a night plus the odd
  // manual sync — it must never look like load to the live DMS.
  pool ??= mysql.createPool({ uri: url, connectionLimit: 2, maxIdle: 1, idleTimeout: 30_000, charset: "utf8mb4", dateStrings: true });
  return pool;
}

const rows = <T>(r: unknown): T[] => (Array.isArray(r) ? (r[0] as T[]) : []);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Cheap connectivity probe for the settings page / healthcheck. */
export async function dmsPing(): Promise<{ ok: boolean; error?: string; brands?: number }> {
  try {
    const r = await getPool().query("SELECT COUNT(*) AS n FROM stock_brand");
    return { ok: true, brands: Number(rows<{ n: number }>(r)[0]?.n ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Nameplates of one SPS brand. `sto_br_id` is a VARCHAR on these tables, so
 * it is bound as a string; brand 0 (Hyundai) is a real brand, not a sentinel,
 * and the blank id-0 "null object" rows are filtered out by name.
 */
export async function fetchNameplates(stoBrId: number): Promise<DmsNameplate[]> {
  const p = getPool();
  const [main, live] = await Promise.all([
    p.query("SELECT sto_mo_ma_id, sto_mo_ma_desc, sto_mo_ma_name_th FROM stock_model_main WHERE sto_br_id = ?", [String(stoBrId)]),
    p.query("SELECT DISTINCT sto_mo_name FROM stock_model WHERE sto_br_id = ? AND st_id IN ('1','3')", [String(stoBrId)]),
  ]);
  const active = new Set(rows<{ sto_mo_name: string }>(live).map((r) => str(r.sto_mo_name).toLowerCase()).filter(Boolean));
  return rows<{ sto_mo_ma_id: number; sto_mo_ma_desc: string; sto_mo_ma_name_th: string | null }>(main)
    .map((r) => ({
      dmsModelId: Number(r.sto_mo_ma_id),
      name: str(r.sto_mo_ma_desc),
      nameTh: str(r.sto_mo_ma_name_th) || null,
      isActive: active.has(str(r.sto_mo_ma_desc).toLowerCase()),
    }))
    .filter((r) => r.name.length > 0);
}

/**
 * Colours of one SPS brand, tagged with the nameplate they belong to.
 * Naming: newer rows fill sto_co_desc_th properly; older ones cram the Thai
 * name into sto_co_desc inside parentheses — SPS itself splits on "(" when it
 * prints them (php_ajax/get_car_details.php), so we do the same.
 */
export async function fetchColors(stoBrId: number): Promise<DmsColor[]> {
  const r = await getPool().query(
    "SELECT sto_co_id, sto_co_code, sto_co_desc, sto_co_desc_th, sto_mo_name, st_id FROM stock_color WHERE sto_br_id = ?",
    [String(stoBrId)],
  );
  return rows<{ sto_co_id: number; sto_co_code: string; sto_co_desc: string; sto_co_desc_th: string | null; sto_mo_name: string; st_id: string }>(r)
    .map((c) => {
      const th = str(c.sto_co_desc_th);
      const en = str(c.sto_co_desc).split("(")[0];
      return {
        dmsColorId: Number(c.sto_co_id),
        code: str(c.sto_co_code) || null,
        name: (th || en || str(c.sto_co_desc)).trim(),
        nameplate: str(c.sto_mo_name),
        isActive: ["1", "3"].includes(str(c.st_id)),
      };
    })
    .filter((c) => c.name.length > 0 && c.nameplate.length > 0);
}
