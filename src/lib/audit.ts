import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Application audit log (user req 2026-09-09) → fun_audit_log (sql/033).
 *
 *   audit({ action: "lead.stage", entityType: "lead", entityId: leadId,
 *           before: { stage: "new" }, after: { stage: "booking" } });
 *
 * Fire-and-forget: never throws, never awaited on the request path (a log
 * failure must not fail the business action). Actor / ip / user-agent /
 * request id are read from the current request when not supplied, so route
 * handlers need only name the action; jobs pass source:"job" + no actor.
 *
 * Contents policy: keys that look like secrets are dropped and phone numbers
 * masked before serialisation (see sanitize) — the log must be safe to hand
 * to a reviewer without redaction.
 */
export type AuditSource = "web" | "api" | "job" | "webhook" | "sso";
export type AuditResult = "ok" | "denied" | "error";

export type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string | number | bigint | null;
  branchId?: number | null;
  before?: unknown;
  after?: unknown;
  result?: AuditResult;
  detail?: string | null;
  source?: AuditSource;
  // Explicit actor for contexts with no session (jobs, webhooks, SSO verify).
  actor?: { userId?: number | null; name?: string | null; role?: string | null } | null;
  // Explicit request when headers() isn't available (e.g. NextAuth callbacks).
  req?: Request | null;
};

const SECRET_KEY = /pass|token|secret|ticket|citizen|hash|otp|key$/i;
const PHONE = /^0\d{8,9}$/;
const MAX_JSON = 4000;

export function sanitize(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return PHONE.test(v) ? v.slice(0, 3) + "***" + v.slice(-3) : v;
  if (typeof v !== "object") return v;
  if (depth > 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => sanitize(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = sanitize(val, depth + 1);
  }
  return out;
}

function toJson(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  try {
    const s = JSON.stringify(sanitize(v));
    return s.length > MAX_JSON ? s.slice(0, MAX_JSON - 1) + "…" : s;
  } catch {
    return null;
  }
}

// Only the fields that actually changed, on both sides — keeps lead/user
// updates readable instead of dumping whole rows.
export function diffFields<T extends Record<string, unknown>>(before: T | null | undefined, after: Partial<T> | null | undefined): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {}, a: Record<string, unknown> = {};
  for (const k of Object.keys(after ?? {})) {
    const bv = before?.[k], av = after?.[k];
    const same = bv === av || (bv instanceof Date && av instanceof Date && bv.getTime() === av.getTime()) || String(bv) === String(av);
    if (!same) { b[k] = bv; a[k] = av; }
  }
  return { before: b, after: a };
}

export function clientIp(h: { get(name: string): string | null }): string | null {
  const fwd = h.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : null) || h.get("cf-connecting-ip") || h.get("x-real-ip") || null;
}

async function requestMeta(req?: Request | null): Promise<{ ip: string | null; ua: string | null; requestId: string | null }> {
  let h: { get(name: string): string | null } | null = req?.headers ?? null;
  if (!h) {
    try { h = await headers(); } catch { h = null; }
  }
  if (!h) return { ip: null, ua: null, requestId: null };
  return {
    ip: clientIp(h),
    ua: h.get("user-agent")?.slice(0, 255) ?? null,
    requestId: h.get("x-request-id")?.slice(0, 36) ?? null,
  };
}

async function sessionActor(): Promise<{ userId: number | null; name: string | null; role: string | null }> {
  try {
    // Lazy import: src/auth.ts itself calls audit() from its callbacks, so a
    // static import here would be a module cycle.
    const { auth } = await import("@/auth");
    const session = await auth();
    const u = session?.user as Record<string, unknown> | undefined;
    return {
      userId: typeof u?.funUserId === "number" ? u.funUserId : null,
      name: typeof u?.name === "string" ? u.name : null,
      role: typeof u?.role === "string" ? u.role : null,
    };
  } catch {
    return { userId: null, name: null, role: null };
  }
}

export async function auditNow(input: AuditInput): Promise<void> {
  try {
    const actor = input.actor === undefined ? await sessionActor() : (input.actor ?? { userId: null, name: null, role: null });
    const meta = await requestMeta(input.req);
    await prisma.auditLog.create({
      data: {
        actorUserId: actor.userId ?? null,
        actorName: actor.name?.slice(0, 100) ?? null,
        actorRole: actor.role?.slice(0, 20) ?? null,
        source: input.source ?? (input.actor === undefined ? "web" : "api"),
        action: input.action.slice(0, 50),
        entityType: input.entityType?.slice(0, 30) ?? null,
        entityId: input.entityId === null || input.entityId === undefined ? null : String(input.entityId).slice(0, 40),
        branchId: input.branchId ?? null,
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.ua,
        requestId: meta.requestId ?? crypto.randomUUID(),
        beforeJson: toJson(input.before),
        afterJson: toJson(input.after),
        result: input.result ?? "ok",
        detail: input.detail?.slice(0, 500) ?? null,
      },
    });
  } catch (e) {
    console.error("[audit] write failed", input.action, e);
  }
}

export function audit(input: AuditInput): void {
  void auditNow(input);
}
