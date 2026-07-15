import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignature, flattenLeadFields, type FbField } from "@/lib/meta";
import { ingestLead } from "@/lib/leads";
import { linePushFlex } from "@/lib/flex";
import { getLineCredsForBrand } from "@/lib/lineConfig";

export const runtime = "nodejs";

/**
 * Facebook Lead Ads webhook — the app owns this end to end (Phase 2):
 *   GET  → answer Meta's hub.challenge verification
 *   POST → verify X-Hub-Signature-256, fetch each lead from the Graph API,
 *          ingest (channel lookup + dedupe/reopen), and push the LINE card.
 *
 * Secrets come from env (LAN-only container): META_VERIFY_TOKEN ·
 * META_APP_SECRET · FB_SYSTEM_USER_TOKEN. LINE credentials come from the
 * ingested lead's own brand (getLineCredsForBrand) since 2026-07-15 — no
 * longer the single legacy LINE_CHANNEL_ACCESS_TOKEN.
 *
 * AI never messages the customer — this only notifies the sales group; a human
 * sends the follow-up (handoff hard rule).
 */
const GRAPH = "https://graph.facebook.com/v21.0";

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const ok = p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.META_VERIFY_TOKEN;
  console.log(`[fb-meta] GET verify mode=${p.get("hub.mode")} tokenMatch=${ok}`);
  if (ok) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const appSecret = process.env.META_APP_SECRET ?? "";
  const sigHeader = request.headers.get("x-hub-signature-256");
  const sigOk = verifyMetaSignature(raw, sigHeader, appSecret);
  console.log(`[fb-meta] POST received bytes=${raw.length} sigHeaderPresent=${!!sigHeader} sigOk=${sigOk}`);
  if (!sigOk) {
    console.log(`[fb-meta] rejected: bad signature`);
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
  }

  let body: { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: Record<string, unknown> }> }> };
  try {
    body = JSON.parse(raw);
  } catch {
    console.log(`[fb-meta] rejected: bad json, raw=${raw.slice(0, 300)}`);
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }
  console.log(`[fb-meta] parsed entries=${body.entry?.length ?? 0}`);

  const fbToken = process.env.FB_SYSTEM_USER_TOKEN ?? "";

  // Collect leadgen ids first so we can ACK Meta fast even if downstream is slow.
  const jobs: { leadgenId: string; pageId: string }[] = [];
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      if (ch.field === "leadgen" && v.leadgen_id) {
        jobs.push({ leadgenId: String(v.leadgen_id), pageId: String(v.page_id ?? entry.id ?? "") });
      }
    }
  }

  const results: string[] = [];
  for (const job of jobs) {
    try {
      // 1. Fetch the full lead from the Graph API.
      const url = `${GRAPH}/${job.leadgenId}?access_token=${encodeURIComponent(fbToken)}&fields=field_data`;
      const res = await fetch(url);
      if (!res.ok) { results.push(`fetch_fail:${res.status}`); continue; }
      const lead = (await res.json()) as { field_data?: FbField[] };
      const flat = flattenLeadFields(lead.field_data ?? []);

      // 2. Ingest (channel lookup + dedupe/reopen + build card).
      const out = await ingestLead({ source: "facebook", pageId: job.pageId, leadgenId: job.leadgenId, ...flat });
      if (!out.ok) { results.push(out.reason); continue; }

      // 3. Push the card to the mapped sales group — per-brand OA (user req
      // 2026-07-15 — retire the single legacy channel everywhere).
      const creds = await getLineCredsForBrand(out.brandId);
      if (creds.accessToken) {
        const push = await linePushFlex(creds.accessToken, out.lineGroupId, out.altText, out.flex);
        results.push(push.ok ? (out.reopen ? "reopen_sent" : "new_sent") : `push_fail:${push.status}`);
      } else {
        results.push("no_line_token");
      }
    } catch (e) {
      results.push(`err:${String(e).slice(0, 80)}`);
    }
  }

  console.log(`[fb-meta] done jobs=${jobs.length} results=${JSON.stringify(results)}`);
  // Always 200 so Meta doesn't disable the subscription over a transient error.
  return NextResponse.json({ ok: true, processed: jobs.length, results });
}
