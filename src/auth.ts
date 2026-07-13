import NextAuth from "next-auth";
import Line from "next-auth/providers/line";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// Two ways in (user request 2026-07-08): LINE Login (self-service registration,
// admin approves) AND username+password (for staff without/who don't want to
// use personal LINE, or as a LINE-outage fallback). Both land on the same
// fun_user row and the same approval/role gate — a username+password account
// still needs approvedAt set before it can do anything but see /pending.
//  - LINE: first sign-in auto-creates a PENDING fun_user; bootstrap admin if
//    none exists yet.
//  - Credentials: an admin creates the username + issues a temp password in
//    /settings/users (mustChangePassword=1 until the user sets their own).
// Auth is DISABLED entirely (middleware passes everything) until
// AUTH_LINE_ID/AUTH_LINE_SECRET are set — prevents locking ourselves out
// before the LINE Login channel exists. Credentials login only matters once
// auth is enabled anyway (same gate).
export const authEnabled = !!process.env.AUTH_LINE_ID && !!process.env.AUTH_LINE_SECRET;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Line({
      clientId: process.env.AUTH_LINE_ID ?? "unset",
      clientSecret: process.env.AUTH_LINE_SECRET ?? "unset",
      checks: ["state"],
    }),
    Credentials({
      credentials: { username: {}, password: {} },
      authorize: async (creds) => {
        const username = String(creds?.username ?? "").trim();
        const password = String(creds?.password ?? "");
        if (!username || !password) return null;
        const user = await prisma.funUser.findFirst({ where: { username } });
        if (!user || !user.passwordHash || user.isActive !== 1) return null;
        // Brute-force lockout: refuse while locked, even with the right password.
        if (user.lockedUntil && user.lockedUntil > new Date()) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const count = user.failedLoginCount + 1;
          await prisma.funUser.update({
            where: { userId: user.userId },
            data: count >= 5
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) }
              : { failedLoginCount: count },
          });
          return null;
        }
        if (user.failedLoginCount || user.lockedUntil) {
          await prisma.funUser.update({ where: { userId: user.userId }, data: { failedLoginCount: 0, lockedUntil: null } });
        }
        return { id: String(user.userId), name: user.displayName };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "credentials") return true; // gated inside authorize()
      if (account?.provider !== "line") return false;
      const lineId = account.providerAccountId;
      if (!lineId) return false;
      const existing = await prisma.funUser.findFirst({ where: { lineUserid: lineId } });
      if (!existing) {
        const adminExists = await prisma.funUser.count({
          where: { role: "admin", isActive: 1, approvedAt: { not: null } },
        });
        await prisma.funUser.create({
          data: {
            displayName: user.name ?? "LINE User",
            lineUserid: lineId,
            pictureUrl: user.image ?? null,
            role: adminExists ? "sales" : "admin",
            approvedAt: adminExists ? null : new Date(),
          },
        });
      } else if (user.image && existing.pictureUrl !== user.image) {
        await prisma.funUser.update({ where: { userId: existing.userId }, data: { pictureUrl: user.image } }).catch(() => {});
      }
      return true;
    },
    // Bake funUserId/role/approved into the JWT at (re)sign-in. This callback
    // runs in the Node runtime (auth routes); middleware only DECODES the token
    // (getToken) so Prisma never runs on edge. Role changes need a re-login.
    async jwt({ token, account, user }) {
      // Determine funUserId once, at initial sign-in, from whichever provider fired.
      if (account?.provider === "line" && account.providerAccountId) {
        const fu = await prisma.funUser.findFirst({ where: { lineUserid: account.providerAccountId } });
        if (fu) token.funUserId = fu.userId;
      } else if (account?.provider === "credentials" && user?.id) {
        token.funUserId = Number(user.id);
      }
      // Refresh role/approved/name/picture from the DB on every call — cheap,
      // and means an admin approval or role change takes effect on next request
      // without forcing a full re-login (only the initial funUserId lookup
      // above needs the account/provider branch).
      if (token.funUserId) {
        const fu = await prisma.funUser.findUnique({ where: { userId: Number(token.funUserId) } });
        if (fu) {
          token.role = fu.role;
          token.approved = !!fu.approvedAt && fu.isActive === 1;
          token.name = fu.displayName;
          token.picture = fu.pictureUrl ?? token.picture;
        }
      }
      return token;
    },
    async session({ session, token }) {
      const u = session.user as unknown as Record<string, unknown>;
      u.funUserId = token.funUserId;
      u.role = token.role;
      u.approved = token.approved;
      return session;
    },
  },
});
