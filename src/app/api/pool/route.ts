import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, managerAllowedBranchIds } from "@/lib/authz";

// Unclaimed fun_lead_pool entries, hot-first (handoff §5: "hot ใน pool แจกต่อใน 24 ชม.").
// Branch-scoped (user req 2026-07-14): manager AND sales only see pool leads
// belonging to their own branches — a Mazda salesperson must not fish leads
// out of the Ford pool. admin/gm see everything; a user with no branch links
// at all falls back to everything (same graceful rule as the QR modal).
export async function GET() {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  let branchScope: number[] | null = null;
  if (rq.role === "sales" || rq.role === "manager") {
    const allowed = await managerAllowedBranchIds(rq.funUserId!);
    if (allowed.length) branchScope = allowed;
  }

  const rows = await prisma.leadPool.findMany({
    where: { claimedAt: null },
    orderBy: [{ priority: "desc" }, { enteredAt: "asc" }],
    take: 100,
  });
  if (rows.length === 0) return NextResponse.json([]);

  const leadIds = rows.map((r) => r.leadId);
  const leads = await prisma.lead.findMany({
    where: { leadId: { in: leadIds }, ...(branchScope ? { branchId: { in: branchScope } } : {}) },
    include: { person: true, brand: true, branch: true },
  });
  const leadById = new Map(leads.map((l) => [String(l.leadId), l]));

  const out = rows
    .filter((r) => leadById.has(String(r.leadId))) // drops out-of-scope leads
    .map((r) => {
      const lead = leadById.get(String(r.leadId))!;
      return {
        poolId: Number(r.poolId),
        leadId: Number(r.leadId),
        enteredAt: r.enteredAt,
        enteredReason: r.enteredReason,
        priority: r.priority,
        customerName: lead.person.nickname || lead.person.firstName,
        brand: lead.brand.brandName,
        branch: lead.branch.branchName,
        temperature: lead.temperature,
        modelInterest: lead.interestedVariant,
      };
    });
  return NextResponse.json(out);
}
