import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBrandIds } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

const VALID_TEMPS = ["hot", "warm", "cold", "any"];
const VALID_CHANNELS = ["walkin", "phone", "online_owned", "online_paid", "oem", "event", "referral", "service", "fleet", "unknown"];

function toIntOrNull(v: unknown): number | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return undefined;
}

// A manager may only touch a rule that's already scoped to a brand they
// manage (not global rules, not other brands' rules) — same restriction as
// creating one. Returns an error response to short-circuit, or null if OK.
async function checkManagerScope(rq: { role: string | null; funUserId: number | null }, ruleId: number, nextBrandId: number | null | undefined) {
  if (rq.role !== "manager") return null;
  const allowed = await managerAllowedBrandIds(rq.funUserId!);
  const existing = await prisma.slaRule.findUnique({ where: { ruleId } });
  if (!existing || existing.scopeBrandId === null || !allowed.includes(existing.scopeBrandId)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์แก้ไขกฎนี้" }, { status: 403 });
  }
  if (nextBrandId !== undefined && (nextBrandId === null || !allowed.includes(nextBrandId))) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ตั้งกฎ SLA ของแบรนด์นี้" }, { status: 403 });
  }
  return null;
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const nextBrandId = typeof b.scopeBrandId === "number" ? b.scopeBrandId : b.scopeBrandId === null ? null : undefined;
  const scopeErr = await checkManagerScope(rq, ruleId, nextBrandId);
  if (scopeErr) return scopeErr;

  const data: Record<string, unknown> = {};

  if (typeof b.scopeBrandId === "number" || b.scopeBrandId === null) data.scopeBrandId = b.scopeBrandId;
  if (typeof b.scopeBranchId === "number" || b.scopeBranchId === null) data.scopeBranchId = b.scopeBranchId;
  if (typeof b.applyTemperature === "string") {
    if (!VALID_TEMPS.includes(b.applyTemperature)) return NextResponse.json({ error: "invalid applyTemperature" }, { status: 400 });
    data.applyTemperature = b.applyTemperature;
  }
  if (b.applyChannelCategory !== undefined) {
    if (b.applyChannelCategory !== null && !VALID_CHANNELS.includes(String(b.applyChannelCategory))) {
      return NextResponse.json({ error: "invalid applyChannelCategory" }, { status: 400 });
    }
    data.applyChannelCategory = b.applyChannelCategory ? String(b.applyChannelCategory) : null;
  }
  for (const f of ["firstResponseMinutes", "followupIntervalDays", "idleNudgeDays", "idleEscalateDays", "idleForfeitDays"] as const) {
    if (f in b) {
      const parsed = toIntOrNull(b[f]);
      if (parsed === undefined) return NextResponse.json({ error: `invalid ${f}` }, { status: 400 });
      data[f] = parsed;
    }
  }
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  if (b.effectiveFrom !== undefined) data.effectiveFrom = typeof b.effectiveFrom === "string" && b.effectiveFrom ? new Date(b.effectiveFrom) : null;

  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.slaRule.update({ where: { ruleId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบกฎ" }, { status: 404 });
  }
}

// fun_sla_event.rule_id has a real DB FK (RESTRICT, no cascade) — a rule
// that's ever been matched by the SLA engine can't be hard-deleted; toggle
// isActive off instead so history stays intact (same policy as branches).
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const ruleId = Number(id);
  if (!Number.isInteger(ruleId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const scopeErr = await checkManagerScope(rq, ruleId, undefined);
  if (scopeErr) return scopeErr;

  const eventsUsingRule = await prisma.slaEvent.count({ where: { ruleId } });
  if (eventsUsingRule) {
    return NextResponse.json({ error: `ลบไม่ได้ — มีเหตุการณ์ SLA ${eventsUsingRule} รายการอ้างถึงกฎนี้อยู่ (ปิดใช้งานแทนได้)` }, { status: 409 });
  }

  try {
    await prisma.slaRule.delete({ where: { ruleId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบกฎ" }, { status: 404 });
  }
}
