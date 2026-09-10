import { NextResponse } from "next/server";
import { requirePerm, managerAllowedBrandIds } from "@/lib/authz";
import { getSetting } from "@/lib/settings";
import { dmsConfigured, dmsPing } from "@/lib/dms/reader";
import { syncDmsCatalog, type SyncBrandResult } from "@/lib/jobs/dmsCatalogSync";

export const runtime = "nodejs";

/**
 * Vehicle catalogue sync from SPS (user req 2026-09-10). GET reports whether
 * the link is configured and when it last ran; POST runs it now. The nightly
 * 02:00 tick does the same work unattended (src/lib/jobs/dmsCatalogSync.ts).
 */

export async function GET() {
  const rq = await requirePerm("settings-models", "edit");
  if (!rq.ok) return rq.response;
  const last = await getSetting<{ at: string; brands: SyncBrandResult[] }>("dms_catalog_sync");
  if (!dmsConfigured()) return NextResponse.json({ configured: false, last });
  const ping = await dmsPing();
  return NextResponse.json({ configured: true, reachable: ping.ok, error: ping.error, last });
}

export async function POST() {
  const rq = await requirePerm("settings-models", "edit");
  if (!rq.ok) return rq.response;
  if (!dmsConfigured()) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าการเชื่อมฐานข้อมูล SPS (DMS_MYSQL_URL)" }, { status: 503 });
  }
  // A manager only syncs the brands they can already manage models for — the
  // same rule POST /api/models applies. Admin/gm sync everything.
  const only = rq.role === "manager" ? await managerAllowedBrandIds(rq.funUserId!) : undefined;
  const result = await syncDmsCatalog(only);
  if (!result.ok) return NextResponse.json({ error: result.error ?? result.skipped ?? "ซิงก์ไม่สำเร็จ" }, { status: 502 });
  return NextResponse.json(result);
}
