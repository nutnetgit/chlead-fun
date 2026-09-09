import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, clientIp } from "@/lib/audit";
import { checkApiToken, consumeTicket } from "@/lib/sso";

export const runtime = "nodejs";

/**
 * SPS → us, server-to-server: "is this ticket real, and who is it?"
 * (docs/SPS_INTEGRATION.md §3.2). Consumes the ticket — a second call with
 * the same ticket gets TICKET_USED.
 *
 *   POST /api/sso/verify   X-Api-Token: <SSO_API_TOKEN>   { "ticket": "…" }
 *   → { ok:true, user:{…}, lead?:{…} }
 *   → { ok:false, error:{ code, message } }   401 bad token · 400 invalid · 410 used/expired
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  if (!checkApiToken(request.headers.get("x-api-token"))) {
    audit({ action: "auth.sso_verify", result: "denied", source: "sso", actor: null, req: request, detail: "bad api token" });
    return NextResponse.json({ ok: false, error: { code: "UNAUTHORIZED", message: "bad X-Api-Token" } }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { ticket?: unknown };
  const r = await consumeTicket(String(body.ticket ?? ""), "out", ip);
  if (!r.ok) {
    audit({ action: "auth.sso_verify", result: "denied", source: "sso", actor: null, req: request, detail: r.code });
    const status = r.code === "TICKET_INVALID" ? 400 : 410;
    return NextResponse.json({ ok: false, error: { code: r.code, message: r.code } }, { status });
  }

  const user = await prisma.funUser.findUnique({ where: { userId: r.row.userId }, include: { branchLinks: { include: { branch: true } } } });
  if (!user || user.isActive !== 1) {
    audit({ action: "auth.sso_verify", result: "denied", source: "sso", actor: { userId: r.row.userId }, req: request, detail: "USER_INACTIVE" });
    return NextResponse.json({ ok: false, error: { code: "USER_INACTIVE", message: "user inactive" } }, { status: 410 });
  }
  const home = user.branchId ? await prisma.branch.findUnique({ where: { branchId: user.branchId } }) : null;

  let lead: Record<string, unknown> | undefined;
  if (r.row.leadId) {
    const l = await prisma.lead.findUnique({ where: { leadId: r.row.leadId }, include: { person: { include: { identifiers: true } }, brand: true, branch: true } });
    const handoff = r.row.handoffId ? await prisma.bookingHandoff.findUnique({ where: { handoffId: r.row.handoffId } }) : null;
    const quote = await prisma.quotation.findFirst({ where: { leadId: r.row.leadId }, orderBy: { createdAt: "desc" } });
    if (l) {
      const phone = l.person.identifiers.find((i) => i.idType === "phone" || i.idType === "phone2")?.idValue ?? null;
      const lineId = l.person.identifiers.find((i) => i.idType === "line_userid")?.idValue ?? null;
      lead = {
        lead_id: Number(l.leadId),
        handoff_id: handoff ? Number(handoff.handoffId) : null,
        dms_pros_id: l.dmsProsId,
        stage: l.stage,
        brand: l.brand.brandName,
        branch_code: l.branch.branchCode ?? l.branch.branchName,
        branch_name: l.branch.branchName,
        // What SPS actually needs to land in the right showroom: it has no
        // company/brand switch of its own, brand is read off the branch
        // (branch.sto_br_id). `branch_id` is SPS's own branch.branch_id
        // (mapped in ตั้งค่า › สาขาและแบรนด์, sql/035) — feed it straight to
        // login.php?program=sales system&branch=… See SPS_INTEGRATION.md §3.2.
        sps: {
          program: "sales system",
          branch_id: l.branch.dmsBranchId,
          sto_br_id: l.brand.dmsBrandId,
          brand_desc: l.brand.brandName,
        },
        customer: {
          person_id: Number(l.personId),
          full_name: handoff?.customerFullname ?? ([l.person.prefix, l.person.firstName, l.person.lastName].filter(Boolean).join(" ") || null),
          nickname: l.person.nickname,
          phone,
          line_userid: lineId,
          address: handoff?.customerAddrFull ?? null,
        },
        vehicle: { model: handoff?.model ?? null, variant: l.interestedVariant, color: l.interestedColor, payment_type: l.paymentType, has_tradein: !!l.hasTradein },
        price: { agreed_price: handoff?.agreedPrice ? Number(handoff.agreedPrice) : null, discount: handoff?.discount ? Number(handoff.discount) : null, deposit_expected: handoff?.depositExpected ? Number(handoff.depositExpected) : null },
        quote: quote ? { quote_id: Number(quote.quoteId), quote_no: quote.quoteNo, total_price: quote.totalPrice ? Number(quote.totalPrice) : null } : null,
      };
    }
  }

  audit({ action: "auth.sso_verify", source: "sso", req: request, actor: { userId: user.userId, name: user.displayName, role: user.role }, entityType: r.row.leadId ? "lead" : "user", entityId: r.row.leadId ?? user.userId, detail: `consumed from ${ip ?? "?"}` });
  return NextResponse.json({
    ok: true,
    issued_at: r.row.issuedAt,
    user: {
      fun_user_id: user.userId,
      dms_user_id: user.dmsUserId,
      line_userid: user.lineUserid,
      username: user.username,
      display_name: user.displayName,
      role: user.role,
      branch_id: user.branchId,
      branch_code: home?.branchCode ?? home?.branchName ?? null,
      dms_branch_id: home?.dmsBranchId ?? null,
      branch_codes: user.branchLinks.map((b) => b.branch.branchCode ?? b.branch.branchName),
      phone: user.phone,
    },
    lead,
  });
}
