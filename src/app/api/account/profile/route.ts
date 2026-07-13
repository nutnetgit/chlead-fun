import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * Self-service profile edit for the currently signed-in user (user req
 * 2026-07-08: "แก้ไขโปรไฟล์" menu under the header user chip). Deliberately
 * scoped to non-sensitive fields only — role, branch, username, password all
 * stay admin-only via /settings/users. Available to every role.
 */
export async function PUT(request: NextRequest) {
  const session = await auth();
  const funUserId = (session?.user as unknown as Record<string, unknown> | undefined)?.funUserId;
  if (!funUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
  if (!displayName) return NextResponse.json({ error: "ต้องระบุชื่อ-นามสกุล" }, { status: 400 });

  const data = {
    displayName,
    nickname: typeof b.nickname === "string" ? b.nickname.trim() || null : null,
    phone: typeof b.phone === "string" ? b.phone.trim() || null : null,
  };

  await prisma.funUser.update({ where: { userId: Number(funUserId) }, data });
  return NextResponse.json({ ok: true });
}
