import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { validatePassword } from "@/lib/password";

/**
 * Self-service password change for the currently signed-in user (works for
 * both LINE-only accounts setting a password for the first time and
 * credentials accounts changing an existing one).
 * Requires the current password unless the account has none yet.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const funUserId = (session?.user as unknown as Record<string, unknown> | undefined)?.funUserId;
  if (!funUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { currentPassword, newPassword } = (await request.json().catch(() => ({}))) as { currentPassword?: string; newPassword?: string };

  const policyError = validatePassword(String(newPassword ?? ""));
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });

  const user = await prisma.funUser.findUnique({ where: { userId: Number(funUserId) } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (user.passwordHash) {
    const ok = await bcrypt.compare(String(currentPassword ?? ""), user.passwordHash);
    if (!ok) return NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(String(newPassword), 10);
  await prisma.funUser.update({ where: { userId: user.userId }, data: { passwordHash, mustChangePassword: 0 } });

  return NextResponse.json({ ok: true });
}
