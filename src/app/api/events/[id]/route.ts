import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

// Branch-scoped write access (user req 2026-07-13, mirrors POST /api/events):
// admin/gm touch anything; a manager only events owned by one of their own
// branches — central events (branchId null) are admin/gm-only.
async function checkEventWriteAccess(campaignId: number) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return { ok: false as const, response: rq.response };
  const event = await prisma.campaign.findUnique({ where: { campaignId } });
  if (!event) return { ok: false as const, response: NextResponse.json({ error: "ไม่พบ event" }, { status: 404 }) };
  if (rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (event.branchId === null || !allowed.includes(event.branchId)) {
      return { ok: false as const, response: NextResponse.json({ error: "event นี้ไม่ได้อยู่ในสาขาของคุณ" }, { status: 403 }) };
    }
  }
  return { ok: true as const, role: rq.role, funUserId: rq.funUserId };
}

// Update event (name/dates/target + replace brands/targets when arrays sent).
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const access = await checkEventWriteAccess(campaignId);
  if (!access.ok) return access.response;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  // Reassigning the owning branch: admin/gm freely (null = central); a
  // manager only between their own branches.
  if (b.branchId === null || Number.isInteger(b.branchId)) {
    const next = b.branchId as number | null;
    if (access.role === "manager") {
      const allowed = await managerAllowedBranchIds(access.funUserId!);
      if (next === null || !allowed.includes(next)) {
        return NextResponse.json({ error: "ย้าย event ไปสาขาที่ไม่ใช่ของคุณไม่ได้" }, { status: 403 });
      }
    }
    data.branchId = next;
  }
  if (typeof b.eventName === "string" && b.eventName.trim()) data.campaignName = b.eventName.trim();
  if (b.startDate) data.startDate = new Date(String(b.startDate));
  if (b.endDate) data.endDate = new Date(String(b.endDate));
  if (typeof b.targetLeads === "number" || b.targetLeads === null) data.targetLeads = b.targetLeads;
  if (typeof b.linePromoMessage === "string" || b.linePromoMessage === null) data.linePromoMessage = typeof b.linePromoMessage === "string" ? (b.linePromoMessage.trim() || null) : null;

  try {
    if (Object.keys(data).length) await prisma.campaign.update({ where: { campaignId }, data });
    if (Array.isArray(b.brandIds)) {
      const brandIds = b.brandIds.filter((x) => Number.isInteger(x)) as number[];
      await prisma.$transaction([
        prisma.campaignBrand.deleteMany({ where: { campaignId } }),
        ...(brandIds.length ? [prisma.campaignBrand.createMany({ data: brandIds.map((brandId) => ({ campaignId, brandId })) })] : []),
      ]);
    }
    if (Array.isArray(b.targets)) {
      const rows = (b.targets as { userId?: number; targetLeads?: number }[])
        .filter((t) => Number.isInteger(t.userId))
        .map((t) => ({ campaignId, userId: t.userId as number, targetLeads: Number(t.targetLeads) || 0 }));
      await prisma.$transaction([
        prisma.campaignTarget.deleteMany({ where: { campaignId } }),
        ...(rows.length ? [prisma.campaignTarget.createMany({ data: rows })] : []),
      ]);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบ event" }, { status: 404 });
  }
}

// Delete-if-unused: blocked once leads reference the event.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const campaignId = Number(id);
  if (!Number.isInteger(campaignId)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const access = await checkEventWriteAccess(campaignId);
  if (!access.ok) return access.response;
  const leads = await prisma.lead.count({ where: { campaignId } });
  if (leads) return NextResponse.json({ error: `ลบไม่ได้ — มี Lead จาก event นี้ ${leads} ราย` }, { status: 409 });
  await prisma.$transaction([
    prisma.campaignBrand.deleteMany({ where: { campaignId } }),
    prisma.campaignTarget.deleteMany({ where: { campaignId } }),
    prisma.campaign.delete({ where: { campaignId } }),
  ]);
  return NextResponse.json({ ok: true });
}
