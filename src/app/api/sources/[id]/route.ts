import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const channelId = Number(id);
  if (!Number.isInteger(channelId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.channelName === "string" && b.channelName.trim()) data.channelName = b.channelName.trim();
  if (typeof b.isActive === "boolean") data.isActive = b.isActive ? 1 : 0;
  if (typeof b.responsiblePerson === "string") data.responsiblePerson = b.responsiblePerson.trim() || null;
  if (typeof b.budget === "number" || b.budget === null) data.budget = b.budget;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  try {
    await prisma.sourceChannel.update({ where: { channelId }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "ไม่พบแหล่งที่มา" }, { status: 404 });
  }
}

// Delete-if-unused policy (same convention as brand/branch/model — user
// decision 2026-07-07): any lead referencing this source blocks the delete.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const { id } = await params;
  const channelId = Number(id);
  if (!Number.isInteger(channelId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const leads = await prisma.lead.count({ where: { channelId } });
  if (leads) return NextResponse.json({ error: `ลบไม่ได้ — มี Lead ใช้แหล่งที่มานี้อยู่ ${leads} ราย` }, { status: 409 });

  await prisma.sourceChannel.delete({ where: { channelId } });
  return NextResponse.json({ ok: true });
}
