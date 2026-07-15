import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

// SLA rule settings (user req 2026-07-14 — flagged 2026-07-14 as "the next
// thing to build" after the Dashboard SLA explainer went in: fun_sla_rule
// had zero admin UI, only raw DB rows matched by matchSlaRule() in
// src/lib/sla.ts). Split into its own delegable menu key 2026-07-15 (same
// pattern as /api/models) so a manager can be granted this without also
// getting users/branches/automation/etc — a manager's writes are scoped to
// brands they manage, checked below, not just hidden in the UI.
//
// apply_temperature is a real DB ENUM('hot','warm','cold','any') — only ever
// send one of those four exact strings (see the DB VARCHAR gotcha memory:
// this table predates the 006_enum_to_varchar.sql audit and was never
// converted, so it's still ENUM-in-DB + String-in-Prisma; safe as long as
// every write here stays within the enum's allowed values).
const VALID_TEMPS = ["hot", "warm", "cold", "any"];
const VALID_CHANNELS = ["walkin", "phone", "online_owned", "online_paid", "oem", "event", "referral", "service", "fleet", "unknown"];

export async function GET() {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const [rulesAll, brandsAll, branchesAll] = await Promise.all([
    prisma.slaRule.findMany({ orderBy: { ruleId: "asc" } }),
    prisma.brand.findMany({ orderBy: { brandId: "asc" } }),
    prisma.branch.findMany({ orderBy: { branchName: "asc" } }),
  ]);

  // A manager sees global (unscoped) rules too — those affect their brands
  // as well — plus anything scoped to a brand/branch they manage, but can't
  // see rules for brands outside their scope. Dropdown options (brands/
  // branches) are narrowed the same way so a manager can't even pick an
  // out-of-scope brand when creating a rule.
  let rules = rulesAll, brands = brandsAll, branches = branchesAll;
  if (rq.role === "manager") {
    const allowedBrandIds = await managerAllowedBrandIds(rq.funUserId!);
    const allowedBranchIds = new Set(branchesAll.filter((b) => b.brandId !== null && allowedBrandIds.includes(b.brandId)).map((b) => b.branchId));
    rules = rulesAll.filter((r) =>
      (r.scopeBrandId === null && r.scopeBranchId === null) ||
      (r.scopeBrandId !== null && allowedBrandIds.includes(r.scopeBrandId)) ||
      (r.scopeBranchId !== null && allowedBranchIds.has(r.scopeBranchId)));
    brands = brandsAll.filter((b) => allowedBrandIds.includes(b.brandId));
    branches = branchesAll.filter((b) => allowedBranchIds.has(b.branchId));
  }

  const brandName = new Map(brandsAll.map((b) => [b.brandId, b.brandName]));
  const branchName = new Map(branchesAll.map((b) => [b.branchId, b.branchName]));

  return NextResponse.json({
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      scopeBrandId: r.scopeBrandId, scopeBrandName: r.scopeBrandId ? brandName.get(r.scopeBrandId) ?? null : null,
      scopeBranchId: r.scopeBranchId, scopeBranchName: r.scopeBranchId ? branchName.get(r.scopeBranchId) ?? null : null,
      applyTemperature: r.applyTemperature,
      applyChannelCategory: r.applyChannelCategory,
      firstResponseMinutes: r.firstResponseMinutes,
      followupIntervalDays: r.followupIntervalDays,
      idleNudgeDays: r.idleNudgeDays,
      idleEscalateDays: r.idleEscalateDays,
      idleForfeitDays: r.idleForfeitDays,
      isActive: !!r.isActive,
      effectiveFrom: r.effectiveFrom,
    })),
    brands: brands.map((b) => ({ brandId: b.brandId, brandName: b.brandName })),
    branches: branches.map((b) => ({ branchId: b.branchId, branchName: b.branchName, brandId: b.brandId })),
  });
}

function toIntOrNull(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return undefined; // invalid — caller decides whether to reject
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const applyTemperature = typeof b.applyTemperature === "string" && VALID_TEMPS.includes(b.applyTemperature) ? b.applyTemperature : "any";
  if (b.applyChannelCategory !== null && b.applyChannelCategory !== undefined && !VALID_CHANNELS.includes(String(b.applyChannelCategory))) {
    return NextResponse.json({ error: "invalid applyChannelCategory" }, { status: 400 });
  }

  const fields = ["firstResponseMinutes", "followupIntervalDays", "idleNudgeDays", "idleEscalateDays", "idleForfeitDays"] as const;
  const numeric: Record<string, number | null> = {};
  for (const f of fields) {
    const parsed = toIntOrNull(b[f]);
    if (parsed === undefined) return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
    numeric[f] = parsed;
  }

  const scopeBrandId = typeof b.scopeBrandId === "number" ? b.scopeBrandId : null;
  const scopeBranchId = typeof b.scopeBranchId === "number" ? b.scopeBranchId : null;

  // A manager can't create a global rule (affects every brand) and can only
  // scope to a brand/branch they actually manage — checked server-side,
  // same rule as /api/models.
  if (rq.role === "manager") {
    if (scopeBrandId === null) return NextResponse.json({ error: "ผู้จัดการต้องระบุแบรนด์ที่ดูแล — ไม่สามารถตั้งกฎแบบไม่ระบุขอบเขตได้" }, { status: 403 });
    const allowed = await managerAllowedBrandIds(rq.funUserId!);
    if (!allowed.includes(scopeBrandId)) return NextResponse.json({ error: "ไม่มีสิทธิ์ตั้งกฎ SLA ของแบรนด์นี้" }, { status: 403 });
    if (scopeBranchId !== null) {
      const branch = await prisma.branch.findUnique({ where: { branchId: scopeBranchId } });
      if (!branch || branch.brandId !== scopeBrandId) return NextResponse.json({ error: "สาขานี้ไม่อยู่ในแบรนด์ที่เลือก" }, { status: 400 });
    }
  }

  try {
    const row = await prisma.slaRule.create({
      data: {
        scopeBrandId, scopeBranchId,
        applyTemperature,
        applyChannelCategory: b.applyChannelCategory ? String(b.applyChannelCategory) : null,
        firstResponseMinutes: numeric.firstResponseMinutes,
        followupIntervalDays: numeric.followupIntervalDays,
        idleNudgeDays: numeric.idleNudgeDays,
        idleEscalateDays: numeric.idleEscalateDays,
        idleForfeitDays: numeric.idleForfeitDays,
        isActive: b.isActive === false ? 0 : 1,
        effectiveFrom: typeof b.effectiveFrom === "string" && b.effectiveFrom ? new Date(b.effectiveFrom) : null,
      },
    });
    return NextResponse.json({ ok: true, ruleId: row.ruleId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "บันทึกไม่สำเร็จ" }, { status: 409 });
  }
}
