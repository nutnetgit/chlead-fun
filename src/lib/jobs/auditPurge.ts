import { prisma } from "@/lib/prisma";
import { purgeSsoTickets } from "@/lib/sso";

/**
 * Audit-log retention (user req 2026-09-09): rows older than
 * AUDIT_RETENTION_DAYS (default 365) are deleted; sign-in and permission
 * changes are kept twice as long. Runs from the hourly scheduler but only
 * acts during the 03:00 tick, in bounded batches.
 */
export async function runAuditPurgeJob(): Promise<{ ok: true; skipped?: string; audit?: number; sso?: number }> {
  if (new Date().getHours() !== 3) return { ok: true, skipped: "not 03:00" };
  const days = Math.max(30, Number(process.env.AUDIT_RETENTION_DAYS ?? 365) || 365);
  const cutoff = new Date(Date.now() - days * 864e5);
  const longCutoff = new Date(Date.now() - days * 2 * 864e5);
  const LONG_KEEP = ["auth.", "user.perm_change", "user.create", "user.update"];

  const [general, long] = await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { at: { lt: cutoff }, NOT: LONG_KEEP.map((p) => ({ action: { startsWith: p } })) } }),
    prisma.auditLog.deleteMany({ where: { at: { lt: longCutoff } } }),
  ]);
  const sso = await purgeSsoTickets();
  return { ok: true, audit: general.count + long.count, sso };
}
