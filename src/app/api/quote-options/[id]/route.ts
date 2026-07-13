import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const optionId = Number(id);
  if (!Number.isInteger(optionId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.optionName === "string" && b.optionName.trim()) data.optionName = b.optionName.trim();
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  if (typeof b.optionValue === "number" || b.optionValue === null) data.optionValue = b.optionValue;
  if (!Object.keys(data).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.quoteOption.update({ where: { optionId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบรายการ" }, { status: 404 });
  }
}

// No FK dependents yet (quotation module itself isn't built) — always deletable.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm", "manager"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const optionId = Number(id);
  if (!Number.isInteger(optionId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  await prisma.quoteOption.delete({ where: { optionId } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
