import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const VALID_TYPES = new Set(["addon", "reg_insurance"]);

// Quotation option lookup (ADR-015 groundwork) — grouped in the UI into
// "ของแถม" (addon) and "ประเภททะเบียน-ประกัน" (reg_insurance).
export async function GET() {
  const rows = await prisma.quoteOption.findMany({ orderBy: [{ optionType: "asc" }, { optionId: "asc" }] });
  return NextResponse.json(rows.map((r) => ({
    optionId: r.optionId, optionType: r.optionType, optionName: r.optionName,
    optionValue: r.optionValue ? Number(r.optionValue) : null, isActive: !!r.isActive,
  })));
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const optionType = typeof b.optionType === "string" && VALID_TYPES.has(b.optionType) ? b.optionType : "";
  const optionName = typeof b.optionName === "string" ? b.optionName.trim() : "";
  if (!optionType || !optionName) return NextResponse.json({ error: "missing optionType/optionName" }, { status: 400 });
  const optionValue = typeof b.optionValue === "number" && Number.isFinite(b.optionValue) ? b.optionValue : null;

  const row = await prisma.quoteOption.create({ data: { optionType, optionName, optionValue } });
  return NextResponse.json({ ok: true, optionId: row.optionId }, { status: 201 });
}
