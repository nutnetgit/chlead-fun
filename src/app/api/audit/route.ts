import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePerm } from "@/lib/authz";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * Audit log browser (user req 2026-09-09) — /logs → "Audit" tab.
 * Filters: actor (user id), action (prefix), entityType, entityId, from, to,
 * q (free text on detail). Paged 50/row. ?format=csv streams the same filter
 * as a file (needs settings·report; the export is itself audited).
 */
const PAGE = 50;

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const csv = p.get("format") === "csv";
  const rq = await requirePerm("settings", csv ? "report" : undefined);
  if (!rq.ok) return rq.response;

  const where = {
    AND: [
      p.get("actor") ? { actorUserId: Number(p.get("actor")) } : {},
      p.get("action") ? { action: { startsWith: p.get("action")! } } : {},
      p.get("entityType") ? { entityType: p.get("entityType")! } : {},
      p.get("entityId") ? { entityId: p.get("entityId")! } : {},
      p.get("result") ? { result: p.get("result")! } : {},
      p.get("from") ? { at: { gte: new Date(`${p.get("from")}T00:00:00`) } } : {},
      p.get("to") ? { at: { lte: new Date(`${p.get("to")}T23:59:59.999`) } } : {},
      p.get("q") ? { detail: { contains: p.get("q")! } } : {},
    ],
  };
  const page = Math.max(1, Number(p.get("page")) || 1);

  if (csv) {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { auditId: "desc" }, take: 5000 });
    audit({ action: "report.export", entityType: "audit", detail: `${rows.length} rows, filter=${p.toString().slice(0, 300)}` });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["at", "actor_user_id", "actor_name", "actor_role", "source", "action", "entity_type", "entity_id", "branch_id", "ip", "result", "detail", "before", "after"];
    const body = rows.map((r) => [r.at.toISOString(), r.actorUserId, r.actorName, r.actorRole, r.source, r.action, r.entityType, r.entityId, r.branchId, r.ip, r.result, r.detail, r.beforeJson, r.afterJson].map(esc).join(","));
    return new Response("﻿" + [head.join(","), ...body].join("\r\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit_${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { auditId: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
  ]);
  return NextResponse.json({
    total, page, pageSize: PAGE,
    items: rows.map((r) => ({
      auditId: Number(r.auditId), at: r.at, actorUserId: r.actorUserId, actorName: r.actorName, actorRole: r.actorRole,
      source: r.source, action: r.action, entityType: r.entityType, entityId: r.entityId, branchId: r.branchId,
      ip: r.ip, result: r.result, detail: r.detail, before: r.beforeJson, after: r.afterJson, requestId: r.requestId,
    })),
  });
}
