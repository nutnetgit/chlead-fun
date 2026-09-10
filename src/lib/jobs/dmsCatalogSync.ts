import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { dmsConfigured, fetchColors, fetchNameplates } from "@/lib/dms/reader";

/**
 * Vehicle catalogue sync, SPS → Lead FUN (user req 2026-09-10: "เมื่อมีการ
 * เพิ่มรุ่นรถของยี่ห้อนั้น หรือปรับสีนั้นๆ ให้นำมาแสดง").
 *
 * SPS is the owner of the catalogue; this is a one-way mirror.
 *  · Rows that came from SPS carry dms_model_id / dms_color_id and are
 *    read-only in Lead FUN's settings UI — edit them in SPS.
 *  · Rows typed in here by hand (no dms id) are adopted on the first sync if
 *    the name matches, otherwise left completely alone.
 *  · Nothing is ever deleted: what SPS retires is switched off, because leads
 *    and quotations still point at it (fun_lead.interested_model_id).
 *
 * Runs from the hourly scheduler but only acts on the 02:00 tick, the same
 * hour the CPT project syncs, so the DMS sees both at a quiet time. The
 * settings page can also trigger it on demand (POST /api/models/sync).
 * Requires DMS_MYSQL_URL and a filled-in รหัสยี่ห้อใน SPS on each brand.
 */

export type SyncBrandResult = {
  brand: string;
  models: { created: number; updated: number; deactivated: number };
  colors: { created: number; updated: number; deactivated: number; orphans: number };
};
export type SyncResult = { ok: boolean; skipped?: string; at?: string; brands?: SyncBrandResult[]; error?: string };

const norm = (s: string) => s.trim().toLowerCase();

export async function runDmsCatalogSyncJob(): Promise<SyncResult> {
  if (new Date().getHours() !== 2) return { ok: true, skipped: "not 02:00" };
  return syncDmsCatalog();
}

/** @param onlyBrandIds our own brand ids to limit the run (manager-triggered sync). */
export async function syncDmsCatalog(onlyBrandIds?: number[]): Promise<SyncResult> {
  if (!dmsConfigured()) return { ok: false, skipped: "DMS_MYSQL_URL not set" };

  const brands = await prisma.brand.findMany({ where: { dmsBrandId: { not: null } }, orderBy: { brandId: "asc" } });
  const wanted = onlyBrandIds ? brands.filter((b) => onlyBrandIds.includes(b.brandId)) : brands;
  if (!wanted.length) return { ok: false, skipped: "ยังไม่ได้ผูกรหัสยี่ห้อใน SPS ให้ยี่ห้อใด" };

  const out: SyncBrandResult[] = [];
  try {
    for (const brand of wanted) out.push(await syncBrand(brand.brandId, brand.brandName, brand.dmsBrandId!));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    audit({ action: "settings.dms_sync", result: "error", source: "job", actor: null, detail: error.slice(0, 400) });
    return { ok: false, error, brands: out };
  }

  const at = new Date().toISOString();
  await setSetting("dms_catalog_sync", { at, brands: out });
  const totals = out.reduce(
    (a, b) => ({
      m: a.m + b.models.created + b.models.updated + b.models.deactivated,
      c: a.c + b.colors.created + b.colors.updated + b.colors.deactivated,
    }),
    { m: 0, c: 0 },
  );
  audit({
    action: "settings.dms_sync", source: onlyBrandIds ? "web" : "job", entityType: "model",
    after: { brands: out.length, modelChanges: totals.m, colorChanges: totals.c },
    detail: out.map((b) => `${b.brand}: รุ่น +${b.models.created}/~${b.models.updated}/-${b.models.deactivated} สี +${b.colors.created}/~${b.colors.updated}/-${b.colors.deactivated}`).join(" · ").slice(0, 480),
  });
  return { ok: true, at, brands: out };
}

async function syncBrand(brandId: number, brandName: string, stoBrId: number): Promise<SyncBrandResult> {
  const [nameplates, dmsColors, existing] = await Promise.all([
    fetchNameplates(stoBrId),
    fetchColors(stoBrId),
    prisma.vehicleModel.findMany({ where: { brandId }, include: { colors: true } }),
  ]);
  const res: SyncBrandResult = { brand: brandName, models: { created: 0, updated: 0, deactivated: 0 }, colors: { created: 0, updated: 0, deactivated: 0, orphans: 0 } };

  // ── models (nameplates) ───────────────────────────────────────────────
  const byDms = new Map(existing.filter((m) => m.dmsModelId !== null).map((m) => [m.dmsModelId!, m]));
  const byName = new Map(existing.filter((m) => m.dmsModelId === null).map((m) => [norm(m.modelName), m]));
  const modelIdFor = new Map<string, number>(); // nameplate name (normalised) → our model_id

  for (const np of nameplates) {
    const active = np.isActive ? 1 : 0;
    const hit = byDms.get(np.dmsModelId) ?? byName.get(norm(np.name));
    if (!hit) {
      const row = await prisma.vehicleModel.create({ data: { brandId, modelName: np.name.slice(0, 100), isActive: active, dmsModelId: np.dmsModelId } });
      modelIdFor.set(norm(np.name), row.modelId);
      res.models.created++;
      continue;
    }
    modelIdFor.set(norm(np.name), hit.modelId);
    const data: { modelName?: string; isActive?: number; dmsModelId?: number } = {};
    if (hit.dmsModelId !== np.dmsModelId) data.dmsModelId = np.dmsModelId;
    if (hit.modelName !== np.name.slice(0, 100)) data.modelName = np.name.slice(0, 100);
    if ((hit.isActive ?? 1) !== active) data.isActive = active;
    if (Object.keys(data).length) {
      await prisma.vehicleModel.update({ where: { modelId: hit.modelId }, data });
      res.models.updated++;
    }
  }

  // Retired in SPS → switch off here, never delete (leads still reference it).
  const liveDmsIds = new Set(nameplates.map((n) => n.dmsModelId));
  const gone = existing.filter((m) => m.dmsModelId !== null && !liveDmsIds.has(m.dmsModelId) && (m.isActive ?? 1) === 1);
  for (const m of gone) {
    await prisma.vehicleModel.update({ where: { modelId: m.modelId }, data: { isActive: 0 } });
    res.models.deactivated++;
  }

  // ── colours ───────────────────────────────────────────────────────────
  // SPS keys a colour by (nameplate, brand); ours hang off the model row, so
  // a colour whose nameplate we don't carry is counted and skipped.
  const colorsByDms = new Map<number, (typeof existing)[number]["colors"][number]>();
  const colorsByModelName = new Map<string, (typeof existing)[number]["colors"][number]>();
  for (const m of existing) {
    for (const c of m.colors) {
      if (c.dmsColorId !== null) colorsByDms.set(c.dmsColorId, c);
      else colorsByModelName.set(`${m.modelId}|${norm(c.colorName)}`, c);
    }
  }
  const usedNames = new Map<string, number>(); // modelId|name → dms colour id holding it
  for (const m of existing) for (const c of m.colors) usedNames.set(`${m.modelId}|${norm(c.colorName)}`, c.dmsColorId ?? -1);

  const liveColorIds = new Set<number>();
  for (const col of dmsColors) {
    const modelId = modelIdFor.get(norm(col.nameplate));
    if (!modelId) { res.colors.orphans++; continue; }
    liveColorIds.add(col.dmsColorId);

    // VARCHAR(50) + uk_model_color(model_id, color_name): trim, and if that
    // name is already taken by a different colour, qualify it with the code.
    let name = col.name.slice(0, 50);
    const taken = usedNames.get(`${modelId}|${norm(name)}`);
    if (taken !== undefined && taken !== col.dmsColorId) {
      name = col.code ? `${col.name} ${col.code}`.slice(0, 50) : `${col.name} #${col.dmsColorId}`.slice(0, 50);
    }
    const active = col.isActive ? 1 : 0;
    const hit = colorsByDms.get(col.dmsColorId) ?? colorsByModelName.get(`${modelId}|${norm(col.name)}`);
    if (!hit) {
      await prisma.vehicleColor.create({ data: { modelId, colorName: name, colorCode: col.code, isActive: active, dmsColorId: col.dmsColorId } });
      usedNames.set(`${modelId}|${norm(name)}`, col.dmsColorId);
      res.colors.created++;
      continue;
    }
    const data: { modelId?: number; colorName?: string; colorCode?: string | null; isActive?: number; dmsColorId?: number } = {};
    if (hit.modelId !== modelId) data.modelId = modelId;
    if (hit.dmsColorId !== col.dmsColorId) data.dmsColorId = col.dmsColorId;
    if (hit.colorName !== name) data.colorName = name;
    if ((hit.colorCode ?? null) !== (col.code ?? null)) data.colorCode = col.code;
    if ((hit.isActive ?? 1) !== active) data.isActive = active;
    if (Object.keys(data).length) {
      await prisma.vehicleColor.update({ where: { colorId: hit.colorId }, data });
      res.colors.updated++;
    }
  }

  for (const m of existing) {
    for (const c of m.colors) {
      if (c.dmsColorId === null || liveColorIds.has(c.dmsColorId) || (c.isActive ?? 1) === 0) continue;
      await prisma.vehicleColor.update({ where: { colorId: c.colorId }, data: { isActive: 0 } });
      res.colors.deactivated++;
    }
  }

  return res;
}
