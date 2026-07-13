import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Branch directory (per brand). ?all=1 includes deactivated.
export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get("all") === "1";
  const [branches, brands] = await Promise.all([
    prisma.branch.findMany({ where: all ? {} : { isActive: 1 }, orderBy: [{ brandId: "asc" }, { branchName: "asc" }] }),
    prisma.brand.findMany({ orderBy: { brandId: "asc" }, include: { lineConfig: true } }),
  ]);
  const brandById = new Map(brands.map((b) => [b.brandId, b.brandName]));
  return NextResponse.json({
    // liffId is public/non-secret (embedded in customer-facing QR URLs) —
    // used by QrLeadModal to build the per-brand LIFF link (user req
    // 2026-07-11, see src/lib/lineConfig.ts).
    brands: brands.map((b) => ({ brandId: b.brandId, brandName: b.brandName, liffId: b.lineConfig?.liffId ?? null })),
    branches: branches.map((b) => ({
      branchId: b.branchId, branchName: b.branchName, branchCode: b.branchCode,
      brandId: b.brandId, brandName: b.brandId ? brandById.get(b.brandId) ?? null : null,
      isActive: !!b.isActive,
      companyNameFull: b.companyNameFull, companyAddress: b.companyAddress,
    })),
  });
}

// Create branch. Body: { branchName, branchCode?, brandId?, companyNameFull?, companyAddress? }
export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!b.branchName || typeof b.branchName !== "string") {
    return NextResponse.json({ error: "missing branchName" }, { status: 400 });
  }
  try {
    const row = await prisma.branch.create({
      data: {
        branchName: b.branchName.trim(),
        branchCode: typeof b.branchCode === "string" ? b.branchCode.trim().toUpperCase() || null : null,
        brandId: typeof b.brandId === "number" ? b.brandId : null,
        companyNameFull: typeof b.companyNameFull === "string" ? b.companyNameFull.trim() || null : null,
        companyAddress: typeof b.companyAddress === "string" ? b.companyAddress.trim() || null : null,
      },
    });
    return NextResponse.json({ ok: true, branchId: row.branchId }, { status: 201 });
  } catch (e) {
    const msg = String(e).includes("P2002") ? "รหัสสาขานี้ถูกใช้แล้ว" : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
