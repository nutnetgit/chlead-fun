import NextAuth from "next-auth";
import Line from "next-auth/providers/line";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { consumeTicket } from "@/lib/sso";

// Three ways in:
//  - LINE Login (user request 2026-07-08): self-service registration, admin
//    approves. First sign-in auto-creates a PENDING fun_user; bootstrap
//    admin if none exists yet.
//  - username+password: for staff without/who don't want to use personal
//    LINE, or as a LINE-outage fallback. Admin creates the username + issues
//    a temp password in /settings/users (mustChangePassword=1 until changed).
//  - SSO ticket from SPS (user req 2026-09-09, provider id "sso"): the DMS
//    calls POST /api/sso/issue, the browser lands on /sso?ticket=…, and the
//    ticket is consumed here exactly once. See src/lib/sso.ts.
// All land on the same fun_user row and the same approval/role gate.
//
// Auth is ON unless someone explicitly sets AUTH_DISABLED=1 (local dev).
// Security review 2026-09-12: this used to derive itself from whether
// AUTH_LINE_ID/AUTH_LINE_SECRET happened to be set, so an empty env file
// turned the whole app into an open, admin-rights deployment — requireRole()
// and requirePerm() hand out admin when this is false. Failing closed means
// a misconfigured deploy locks staff out (loud, fixable) instead of exposing
// every customer record (silent, unfixable).
export const authEnabled = process.env.AUTH_DISABLED !== "1";

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
        const fail = (reason: string) => {
          audit({ action: "auth.login_failed", result: "denied", entityType: "user", entityId: user?.userId ?? null,
            actor: { userId: user?.userId ?? null, name: username, role: user?.role ?? null }, detail: reason });
          return null;
        };
        if (!user || !user.passwordHash || user.isActive !== 1) return fail(!user ? "unknown username" : !user.passwordHash ? "no password set" : "inactive");
        // Brute-force lockout: refuse while locked, even with the right password.
        if (user.lockedUntil && user.lockedUntil > new Date()) return fail("locked");
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          const count = user.failedLoginCount + 1;
          await prisma.funUser.update({
            where: { userId: user.userId },
            data: count >= 5
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + 15 * 60_000) }
              : { failedLoginCount: count },
          });
          return fail(count >= 5 ? "wrong password → locked 15 min" : `wrong password (${count}/5)`);
        }
        if (user.failedLoginCount || user.lockedUntil) {
          await prisma.funUser.update({ where: { userId: user.userId }, data: { failedLoginCount: 0, lockedUntil: null } });
        }
        return { id: String(user.userId), name: user.displayName };
      },
    }),
    Credentials({
      id: "sso",
      name: "SPS SSO",
      credentials: { ticket: {} },
      authorize: async (creds) => {
        const ticket = String(creds?.ticket ?? "");
        const r = await consumeTicket(ticket, "in", null);
        if (!r.ok) {
          audit({ action: "auth.sso_consume", result: "denied", source: "sso", actor: null, detail: r.code });
          return null;
        }
        const user = await prisma.funUser.findUnique({ where: { userId: r.row.userId } });
        if (!user || user.isActive !== 1 || !user.approvedAt) {
          audit({ action: "auth.sso_consume", result: "denied", source: "sso", actor: { userId: r.row.userId }, detail: "user inactive/unapproved" });
          return null;
        }
        audit({ action: "auth.sso_consume", source: "sso", actor: { userId: user.userId, name: user.displayName, role: user.role }, entityType: "user", entityId: user.userId, detail: r.row.target ?? "/" });
        return { id: String(user.userId), name: user.displayName };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  events: {
    async signIn({ user, account }) {
      const fu = account?.provider === "line"
        ? await prisma.funUser.findFirst({ where: { lineUserid: account.providerAccountId } })
        : user.id ? await prisma.funUser.findUnique({ where: { userId: Number(user.id) } }) : null;
      audit({ action: "auth.login", entityType: "user", entityId: fu?.userId ?? null,
        actor: { userId: fu?.userId ?? null, name: fu?.displayName ?? user.name ?? null, role: fu?.role ?? null },
        detail: `provider=${account?.provider ?? "?"}` });
    },
    async signOut(message) {
      const token = "token" in message ? (message.token as Record<string, unknown> | null) : null;
      const userId = typeof token?.funUserId === "number" ? token.funUserId : null;
      audit({ action: "auth.logout", entityType: "user", entityId: userId, actor: { userId, name: typeof token?.name === "string" ? token.name : null, role: typeof token?.role === "string" ? token.role : null } });
    },
  },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "credentials" || account?.provider === "sso") return true; // gated inside authorize()
      if (account?.provider !== "line") return false;
      const lineId = account.providerAccountId;
      if (!lineId) return false;
      const existing = await prisma.funUser.findFirst({ where: { lineUserid: lineId } });
      if (!existing) {
        const adminExists = await prisma.funUser.count({
          where: { role: "admin", isActive: 1, approvedAt: { not: null } },
        });
        const created = await prisma.funUser.create({
          data: {
            displayName: user.name ?? "LINE User",
            lineUserid: lineId,
            pictureUrl: user.image ?? null,
            role: adminExists ? "sales" : "admin",
            approvedAt: adminExists ? null : new Date(),
          },
        });
        audit({ action: "user.create", entityType: "user", entityId: created.userId, actor: { userId: created.userId, name: created.displayName, role: created.role }, detail: "self-registered via LINE" });
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
      } else if ((account?.provider === "credentials" || account?.provider === "sso") && user?.id) {
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
