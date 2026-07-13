import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// CSV export of filtered leads (same filters as /api/reports) — for working
// the data elsewhere (Excel, ส่งต่อฝ่ายอื่น). UTF-8 BOM so Thai opens
// correctly in Excel.
export async function GET(request: NextRequest) {
  const rq = await requireRole(["manager", "gm", "admin"]);
  if (!rq.ok) return rq.response;

  const p = request.nextUrl.searchParams;
  const from = p.get("from") ? new Date(`${p.get("from")}T00:00:00`) : new Date(Date.now() - 90 * 864e5);
  const to = p.get("to") ? new Date(`${p.get("to")}T23:59:59`) : new Date();

  const leads = await prisma.lead.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(p.get("brandId") ? { brandId: Number(p.get("brandId")) } : {}),
      ...(p.get("branchId") ? { branchId: Number(p.get("branchId")) } : {}),
      ...(p.get("ownerId") ? { ownerUserId: Number(p.get("ownerId")) } : {}),
    },
    include: { person: { include: { identifiers: true } }, channel: true, brand: true, branch: true },
    orderBy: { leadId: "asc" },
  });
  const users = await prisma.funUser.findMany();
  const userName = new Map(users.map((u) => [u.userId, u.displayName]));

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["lead_id", "วันที่สร้าง", "ชื่อลูกค้า", "เบอร์", "แบรนด์", "สาขา", "ช่องทาง", "รุ่นที่สนใจ", "สี", "temperature", "ai_score", "stage", "status", "เซลส์", "นัดถัดไป"];
  const rows = leads.map((l) => [
    Number(l.leadId),
    l.createdAt?.toISOString().slice(0, 10) ?? "",
    l.person.nickname || [l.person.firstName, l.person.lastName].filter(Boolean).join(" "),
    l.person.identifiers.find((i) => i.idType === "phone" || i.idType === "phone2")?.idValue ?? "",
    l.brand.brandName, l.branch.branchName, l.channel.channelName,
    l.interestedVariant ?? "", l.interestedColor ?? "",
    l.temperature ?? "", l.aiScore ?? "", l.stage, l.status,
    l.ownerUserId ? (userName.get(l.ownerUserId) ?? "") : "",
    l.nextActionAt?.toISOString().slice(0, 10) ?? "",
  ].map(esc).join(","));

  const csv = "﻿" + [header.join(","), ...rows].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="chlead-leads-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`,
    },
  });
}
