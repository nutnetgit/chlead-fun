import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Brand master — new brands can be added when the group signs a new marque,
// then showrooms get assigned to it in /settings/branches. `liffId` is
// public/non-secret (it's meant to be embedded in customer-facing QR URLs)
// — used by QrLeadModal and /liff/register to pick the right per-brand LIFF
// app (falls back to the legacy shared NEXT_PUBLIC_LIFF_ID when null, see
// src/lib/lineConfig.ts).
export async function GET() {
  const brands = await prisma.brand.findMany({ orderBy: { brandId: "asc" }, include: { lineConfig: true } });
  return NextResponse.json(brands.map((b) => ({ brandId: b.brandId, brandName: b.brandName, liffId: b.lineConfig?.liffId ?? null })));
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as { brandName?: string };
  const name = b.brandName?.trim();
  if (!name) return NextResponse.json({ error: "missing brandName" }, { status: 400 });
  try {
    const row = await prisma.brand.create({ data: { brandName: name } });
    return NextResponse.json({ ok: true, brandId: row.brandId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "มีแบรนด์ชื่อนี้อยู่แล้ว" }, { status: 409 });
  }
}
