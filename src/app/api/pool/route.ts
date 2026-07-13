import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Unclaimed fun_lead_pool entries, hot-first (handoff §5: "hot ใน pool แจกต่อใน 24 ชม.").
export async function GET() {
  const rows = await prisma.leadPool.findMany({
    where: { claimedAt: null },
    orderBy: [{ priority: "desc" }, { enteredAt: "asc" }],
    take: 100,
  });
  if (rows.length === 0) return NextResponse.json([]);

  const leadIds = rows.map((r) => r.leadId);
  const leads = await prisma.lead.findMany({
    where: { leadId: { in: leadIds } },
    include: { person: true, brand: true, branch: true },
  });
  const leadById = new Map(leads.map((l) => [String(l.leadId), l]));

  const out = rows.map((r) => {
    const lead = leadById.get(String(r.leadId));
    return {
      poolId: Number(r.poolId),
      leadId: Number(r.leadId),
      enteredAt: r.enteredAt,
      enteredReason: r.enteredReason,
      priority: r.priority,
      customerName: lead ? (lead.person.nickname || lead.person.firstName) : null,
      brand: lead?.brand.brandName ?? null,
      branch: lead?.branch.branchName ?? null,
      temperature: lead?.temperature ?? null,
      modelInterest: lead?.interestedVariant ?? null,
    };
  });
  return NextResponse.json(out);
}
