import { NextResponse } from "next/server";
import { getAllSettings } from "@/lib/settings";

// Read-only view of fun_settings for the Status page. fun_settings holds only
// non-secret config + health snapshots (written by n8n), so nothing to redact.
export async function GET() {
  const settings = await getAllSettings();
  return NextResponse.json(settings);
}
