import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/auth";
import { prisma } from "@/lib/prisma";
import { resolvePerms, roleDefaultPerms } from "@/lib/menuAccess";

export const runtime = "nodejs";

// Live "who am I" for the UI (Chrome chip, Sidebar role filter, /pending
// polling, /leads owner scoping). Reads the DB (not just the token) so the
// pending page sees an approval the moment the admin clicks it.
export async function GET() {
  if (!authEnabled) return NextResponse.json({ authEnabled: false, signedIn: false });

  const session = await auth();
  const u = session?.user as (Record<string, unknown> & { name?: string; image?: string }) | undefined;
  if (!u?.funUserId) return NextResponse.json({ authEnabled: true, signedIn: false });

  const fu = await prisma.funUser.findUnique({ where: { userId: Number(u.funUserId) }, include: { menuRows: true } });
  if (!fu) return NextResponse.json({ authEnabled: true, signedIn: false });

  // Effective 6-flag permissions (fun_user_menu rows, else role defaults) —
  // `menus` (the viewable keys) drives the sidebar filter + page gate;
  // `perms` drives per-button visibility. Server routes re-check via requirePerm.
  // Admin is never restricted by rows (same rule as requirePerm).
  const perms = fu.role === "admin" ? roleDefaultPerms("admin") : resolvePerms(fu.role, fu.menuRows);

  return NextResponse.json({
    authEnabled: true,
    signedIn: true,
    spsSso: !!process.env.SPS_SSO_LANDING_URL,
    user: {
      funUserId: fu.userId,
      displayName: fu.displayName,
      nickname: fu.nickname,
      phone: fu.phone,
      role: fu.role,
      approved: !!fu.approvedAt && fu.isActive === 1,
      pictureUrl: fu.pictureUrl,
      branchId: fu.branchId,
      dmsUserId: fu.dmsUserId,
      mustChangePassword: !!fu.mustChangePassword,
      menus: Object.keys(perms),
      perms,
    },
  });
}
