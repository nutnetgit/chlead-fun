import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// Month view data: per-day counts of leads due (next_action_at) and
// appointments — feeds the calendar overlay. ?month=YYYY-MM (default: now),
// ?owner= narrows to a salesperson (sales are always pinned to themselves —
// 2026-07-13 permission audit).
export async function GET(request: NextRequest) {
  const rq = await requireRole(["sales", "manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const p = request.nextUrl.searchParams;
  const monthStr = p.get("month");
  const owner = rq.role === "sales" ? String(rq.funUserId) : p.get("owner");
  const base = monthStr ? new Date(`${monthStr}-01T00:00:00`) : new Date();
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1);

  const [dueLeads, appts] = await Promise.all([
    prisma.lead.findMany({
      where: {
        status: "active",
        nextActionAt: { gte: start, lt: end },
        ...(owner ? { ownerUserId: Number(owner) } : {}),
      },
      select: { nextActionAt: true },
    }),
    prisma.appointment.findMany({
      where: { scheduledAt: { gte: start, lt: end }, status: { in: ["scheduled", "confirmed"] } },
      select: { scheduledAt: true },
    }),
  ]);

  const due: Record<number, number> = {};
  for (const l of dueLeads) {
    if (!l.nextActionAt) continue;
    const d = l.nextActionAt.getDate();
    due[d] = (due[d] ?? 0) + 1;
  }
  const appt: Record<number, number> = {};
  for (const a of appts) {
    const d = a.scheduledAt.getDate();
    appt[d] = (appt[d] ?? 0) + 1;
  }

  return NextResponse.json({
    month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
    daysInMonth: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
    firstDow: start.getDay(), // 0=Sunday
    due, appt,
  });
}
