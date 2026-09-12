import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

// Gatekeeper (edge-safe: only DECODES the session JWT — Prisma never runs
// here; roles/approval are baked into the token at sign-in, see src/auth.ts).
//
// Security review 2026-09-12 — this used to switch itself OFF whenever
// AUTH_LINE_ID/AUTH_LINE_SECRET were empty, which meant one missing env var
// silently published every lead, customer phone number and settings page to
// the internet. It now fails CLOSED: protection is always on unless someone
// deliberately sets AUTH_DISABLED=1 (local development only — never on the
// NAS). A missing AUTH_SECRET now locks staff out instead of letting the
// world in, which is the right way round.
const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";

// Public no matter what: customer QR form, LIFF registration (user req
// 2026-07-08 — this was missing and bounced customers/LIFF sessions to
// /login, since it's a separate list from Chrome.tsx's BARE_ROUTES which
// only controls chrome/no-chrome rendering, not auth), webhooks (own auth),
// cron jobs (x-api-key), auth endpoints themselves, the public lead API.
//
// Matching is by exact path or a real "/" boundary, not bare startsWith, so a
// future route that merely begins with one of these strings can't inherit
// public access by accident (security review 2026-09-12).
const PUBLIC_PATHS = [
  "/login", "/pending", "/lead-form", "/liff",
  "/terms", "/privacy", "/cookies", // legal pages — must be readable pre-login
  "/api/auth", "/api/public", "/api/webhooks", "/api/jobs",
  // SSO with SPS (sql/034): /sso lands an SPS-issued ticket (no session yet);
  // /api/sso/verify + /api/sso/issue are server-to-server, gated by
  // X-Api-Token inside the route, not by a browser session.
  "/sso", "/api/sso/verify", "/api/sso/issue",
];

// Reference data the customer-facing forms read to fill their pickers. READS
// only: the same trees also carry the settings mutations and the SPS
// catalogue-sync trigger, and those must stay behind the session gate even
// though requirePerm() checks them again inside the route.
const PUBLIC_READONLY_PATHS = ["/api/models", "/api/brands"];

// Static assets — genuine prefix matches.
const PUBLIC_PREFIXES = ["/_next", "/favicon"];

function isPublic(pathname: string, method: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  const onPath = (p: string) => pathname === p || pathname.startsWith(p + "/");
  if (PUBLIC_PATHS.some(onPath)) return true;
  if ((method === "GET" || method === "HEAD") && PUBLIC_READONLY_PATHS.some(onPath)) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  if (AUTH_DISABLED) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (isPublic(pathname, req.method)) return NextResponse.next();

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
