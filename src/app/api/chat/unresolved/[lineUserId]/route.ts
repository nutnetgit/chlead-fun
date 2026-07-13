import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Ctx = { params: Promise<{ lineUserId: string }> };

/**
 * Clear an "ไม่ทราบที่มา" (unresolved) chat thread — inbound messages from a
 * LINE user who never scanned a sales QR (e.g. a service inquiry sent to the
 * same brand OA), so there's no lead to route them to. Manager+ only, same
 * scope as /api/chat/inbox's unresolved bucket.
 */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const { lineUserId } = await params;
  if (!lineUserId) return NextResponse.json({ error: "bad id" }, { status: 400 });

  await prisma.chatMessage.deleteMany({ where: { leadId: null, lineUserId } });
  return NextResponse.json({ ok: true });
}
