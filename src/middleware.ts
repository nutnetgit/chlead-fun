import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Gatekeeper (edge-safe: only DECODES the session JWT — Prisma never runs
// here; roles/approval are baked into the token at sign-in, see src/auth.ts).
//
// Disabled entirely while AUTH_LINE_ID/SECRET are unset so the app keeps
// working before the LINE Login channel exists.
//
// Public no matter what: customer QR form, LIFF registration (user req
// 2026-07-08 — this was missing and bounced customers/LIFF sessions to
// /login, since it's a separate list from Chrome.tsx's BARE_ROUTES which
// only controls chrome/no-chrome rendering, not auth), webhooks (own auth),
// cron jobs (x-api-key), auth endpoints themselves, the public lead API, and
// the read-only reference data (models/brands) both public forms fetch to
// populate their pickers.
const PUBLIC_PREFIXES = [
  "/login", "/pending", "/lead-form", "/liff",
  "/api/auth", "/api/public", "/api/webhooks", "/api/jobs",
  "/api/models", "/api/brands",
  "/_next", "/favicon",
];

export async function middleware(req: NextRequest) {
  if (!process.env.AUTH_LINE_ID || !process.env.AUTH_LINE_SECRET) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  // secureCookie MUST be forced true: the app sits behind Cloudflare Tunnel,
  // which terminates TLS at the edge and forwards plain HTTP internally.
  // NextAuth sees the public request as HTTPS and sets __Secure-prefixed
  // cookies, but getToken()'s auto-detection looks at the internal (http)
  // connection and would look for the WRONG (non-prefixed) cookie name,
  // finding nothing and bouncing every request back to /login forever.
  const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: true });

  if (!token) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (!token.approved) {
    if (pathname.startsWith("/api")) {
      // /api/me stays reachable so the pending page can poll live status.
      if (pathname.startsWith("/api/me")) return NextResponse.next();
      return NextResponse.json({ error: "pending approval" }, { status: 403 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/pending";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Exclude Next internals, favicon, and any file with an extension (logo.png,
  // manifest.json, etc.) — those are static assets, never protected routes.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
