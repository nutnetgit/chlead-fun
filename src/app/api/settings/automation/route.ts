import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting, getLineQuotaConfig, setLineQuotaConfig, getLineMessageCount, getOwnerSwitchConfig, setOwnerSwitchConfig, type OwnerSwitchConfig } from "@/lib/settings";
import { requireRole } from "@/lib/authz";

export type AutomationConfig = {
  sla: { enabled: boolean };
  score: { enabled: boolean; hour: number };
  nudge: { enabled: boolean; hour: number };
  digest: { enabled: boolean; hour: number };
};

export type LineQuotaConfig = { welcomeEnabled: boolean; monthlyLimit: number | null };
export type AutomationResponse = AutomationConfig & { lineQuota: LineQuotaConfig; lineMessagesThisMonth: number; ownerSwitch: OwnerSwitchConfig };

const DEFAULT_CONFIG: AutomationConfig = {
  sla: { enabled: true },
  score: { enabled: true, hour: 23 },
  nudge: { enabled: true, hour: 8 },
  digest: { enabled: true, hour: 7 },
};

// Toggle/reschedule the automated jobs from the UI (user req 2026-07-08).
// src/instrumentation.ts owns the actual hourly cron trigger in-process now
// (n8n only handles the FB webhook intake, not these jobs); this endpoint
// controls whether each job DOES anything when the tick fires, and for the
// once-daily jobs, which hour they're allowed to fire in. Also exposes the
// LINE welcome-push quota controls (user req 2026-07-08 — see
// src/lib/settings.ts isLineWelcomeActive).
export async function GET() {
  const saved = await getSetting<Partial<AutomationConfig>>("automation");
  const lineQuota = await getLineQuotaConfig();
  const lineMessagesThisMonth = await getLineMessageCount();
  const ownerSwitch = await getOwnerSwitchConfig();
  return NextResponse.json({ ...DEFAULT_CONFIG, ...saved, lineQuota, lineMessagesThisMonth, ownerSwitch });
}

export async function PUT(request: NextRequest) {
  const rq = await requireRole(["admin", "gm"]);
  if (!rq.ok) return rq.response;

  const body = (await request.json().catch(() => ({}))) as Partial<AutomationConfig> & {
    lineQuota?: { welcomeEnabled?: boolean; monthlyLimit?: number | null };
    ownerSwitch?: Partial<OwnerSwitchConfig>;
  };
  const { lineQuota: lineQuotaPatch, ownerSwitch: ownerSwitchPatch, ...jobPatch } = body;

  if (lineQuotaPatch) await setLineQuotaConfig(lineQuotaPatch);
  if (ownerSwitchPatch) await setOwnerSwitchConfig(ownerSwitchPatch);

  const current = { ...DEFAULT_CONFIG, ...(await getSetting<Partial<AutomationConfig>>("automation")) };
  const next = { ...current, ...jobPatch };
  await setSetting("automation", next);

  const lineQuota = await getLineQuotaConfig();
  const lineMessagesThisMonth = await getLineMessageCount();
  const ownerSwitch = await getOwnerSwitchConfig();
  return NextResponse.json({ ok: true, config: { ...next, lineQuota, lineMessagesThisMonth, ownerSwitch } });
}
