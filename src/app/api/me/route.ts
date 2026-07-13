import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolveMenus } from "@/lib/menuAccess";

export const runtime = "nodejs";

// Live "who am I" for the UI (Chrome chip, Sidebar role filter, /pending
// polling, /leads owner scoping). Reads the DB (not just the token) so the
// pending page sees an approval the moment the admin clicks it.
export async function GET() {
  if (!authEnabled) return NextResponse.json({ authEnabled: false, signedIn: false });

  const session = await auth();
  const u = session?.user as (Record<string, unknown> & { name?: string; image?: string }) | undefined;
  if (!u?.funUserId) return NextResponse.json({ authEnabled: true, signedIn: false });

  const fu = await prisma.funUser.findUnique({ where: { userId: Number(u.funUserId) } });
  if (!fu) return NextResponse.json({ authEnabled: true, signedIn: false });

  return NextResponse.json({
    authEnabled: true,
    signedIn: true,
    user: {
      funUserId: fu.userId,
      displayName: fu.displayName,
      nickname: fu.nickname,
      phone: fu.phone,
      role: fu.role,
      approved: !!fu.approvedAt && fu.isActive === 1,
      pictureUrl: fu.pictureUrl,
      branchId: fu.branchId,
      mustChangePassword: !!fu.mustChangePassword,
      // Effective menu access (role defaults + per-user overrides) — drives
      // the sidebar filter and the page gate in Chrome.tsx.
      menus: resolveMenus(fu.role, fu.menuAccess),
    },
  });
}
