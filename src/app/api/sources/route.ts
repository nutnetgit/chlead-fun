import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

const VALID_CATEGORIES = new Set([
  "walkin", "phone", "online_owned", "online_paid", "oem", "event", "referral", "service", "fleet", "unknown",
]);

// Lead source directory (fun_source_channel) — split in the UI into
// "Showroom" (walkin/phone/referral/service/fleet) vs "Online"
// (online_owned/online_paid/oem/unknown), matching the legacy SPS Prospect
// module's two source-management screens (user req 2026-07-08).
export async function GET() {
  const rows = await prisma.sourceChannel.findMany({ orderBy: { channelId: "asc" } });
  return NextResponse.json(rows.map((r) => ({
    channelId: r.channelId, channelName: r.channelName, category: r.category, isActive: !!r.isActive,
    responsiblePerson: r.responsiblePerson, budget: r.budget ? Number(r.budget) : null,
  })));
}

export async function POST(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const channelName = typeof b.channelName === "string" ? b.channelName.trim() : "";
  const category = typeof b.category === "string" && VALID_CATEGORIES.has(b.category) ? b.category : "";
  if (!channelName || !category) return NextResponse.json({ error: "missing channelName/category" }, { status: 400 });
  const responsiblePerson = typeof b.responsiblePerson === "string" ? b.responsiblePerson.trim() || null : null;
  const budget = typeof b.budget === "number" && Number.isFinite(b.budget) ? b.budget : null;

  const row = await prisma.sourceChannel.create({ data: { channelName, category: category as never, responsiblePerson, budget } });
  return NextResponse.json({ ok: true, channelId: row.channelId }, { status: 201 });
}
