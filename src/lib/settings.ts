import { prisma } from "@/lib/prisma";

// fun_settings holds ONLY non-secret config + token health (handoff §7).
// Secrets (FB token, LINE token, service-account JSON) live in n8n credentials.

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await prisma.setting.findUnique({ where: { settingKey: key } });
  if (!row?.settingValue) return null;
  try {
    return JSON.parse(row.settingValue) as T;
  } catch {
    return row.settingValue as unknown as T;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const settingValue = typeof value === "string" ? value : JSON.stringify(value);
  await prisma.setting.upsert({
    where: { settingKey: key },
    create: { settingKey: key, settingValue },
    update: { settingValue },
  });
}

type AutomationJobKey = "sla" | "score" | "nudge" | "digest";
const AUTOMATION_DEFAULTS: Record<AutomationJobKey, { enabled: boolean; hour?: number }> = {
  sla: { enabled: true },
  score: { enabled: true, hour: 23 },
  nudge: { enabled: true, hour: 8 },
  digest: { enabled: true, hour: 7 },
};

// Gate for the once-daily/hourly job routes (n8n fires the HTTP call; this
// decides whether the job actually does anything) — see /settings/automation.
// hourly jobs (sla) ignore `hour`; the rest skip unless the current server
// hour matches the configured one.
export async function isAutomationJobActive(key: AutomationJobKey): Promise<{ active: boolean; reason?: string }> {
  const saved = await getSetting<Record<string, { enabled: boolean; hour?: number }>>("automation");
  const cfg = { ...AUTOMATION_DEFAULTS[key], ...saved?.[key] };
  if (!cfg.enabled) return { active: false, reason: "disabled in /settings/automation" };
  if (cfg.hour !== undefined && new Date().getHours() !== cfg.hour) {
    return { active: false, reason: `not target hour (configured ${cfg.hour}:00)` };
  }
  return { active: true };
}

// Enabled-only variant, hour ignored. The hourly chat-extract job rides the
// "score" toggle (user decision 2026-07-15: it IS Aira scoring, extended to
// continuous chat re-analysis — one switch controls both) but must not be
// limited to score's once-a-day configured hour.
export async function isAutomationJobEnabled(key: AutomationJobKey): Promise<{ active: boolean; reason?: string }> {
  const saved = await getSetting<Record<string, { enabled: boolean; hour?: number }>>("automation");
  const cfg = { ...AUTOMATION_DEFAULTS[key], ...saved?.[key] };
  if (!cfg.enabled) return { active: false, reason: "disabled in /settings/automation" };
  return { active: true };
}

// ── LINE message quota (user req 2026-07-08) ────────────────────────────────
// LINE's free tier only covers outbound messages (push/reply-to-customer);
// inbound customer messages are free and uncounted. The auto-welcome push
// (fired once per QR scan → LIFF register, see /api/public/lead) is the
// highest-volume outbound source once this is customer-facing at scale, so
// it needs to be independently toggle-able and quota-aware — everything else
// (nudge/digest/SLA pushes) stays always-on since those are lower-volume and
// operationally more important to sales/managers than the welcome push is.
type LineQuotaConfig = { welcomeEnabled: boolean; monthlyLimit: number | null };
const LINE_QUOTA_DEFAULTS: LineQuotaConfig = { welcomeEnabled: true, monthlyLimit: null };

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getLineQuotaConfig(): Promise<LineQuotaConfig> {
  const saved = await getSetting<Partial<LineQuotaConfig>>("lineQuota");
  return { ...LINE_QUOTA_DEFAULTS, ...saved };
}

export async function setLineQuotaConfig(cfg: Partial<LineQuotaConfig>): Promise<void> {
  const current = await getLineQuotaConfig();
  await setSetting("lineQuota", { ...current, ...cfg });
}

// Best-effort counter, keyed by calendar month — approximates LINE's own
// monthly quota reset. Not a precise mirror of LINE's billing (reply-type
// sends aren't tracked here, only linePush/linePushFlex calls), good enough
// to warn an admin before they hit a hard wall.
export async function getLineMessageCount(monthKey = currentMonthKey()): Promise<number> {
  const n = await getSetting<number>(`line_msg_count_${monthKey}`);
  return n ?? 0;
}

export async function trackLineSend(count: number): Promise<void> {
  const key = `line_msg_count_${currentMonthKey()}`;
  const current = (await getSetting<number>(key)) ?? 0;
  await setSetting(key, current + count);
}

// Should the auto-welcome push fire for this scan? False if the admin turned
// it off, or if a monthly limit is set and already reached — in both cases
// the LIFF welcome page still shows the salesperson's name/phone as page
// content (zero LINE quota cost), just skips the push.
export async function isLineWelcomeActive(): Promise<{ active: boolean; reason?: string }> {
  const cfg = await getLineQuotaConfig();
  if (!cfg.welcomeEnabled) return { active: false, reason: "disabled in /settings/automation" };
  if (cfg.monthlyLimit !== null) {
    const used = await getLineMessageCount();
    if (used >= cfg.monthlyLimit) return { active: false, reason: `monthly LINE quota reached (${used}/${cfg.monthlyLimit})` };
  }
  return { active: true };
}

// ── Weighted Pipeline / Lead Aging assumptions (user req 2026-07-11) ───────
// forecast_value = Σ(open leads in tier × tier's close probability), plus the
// aging threshold that auto-downgrades a HOT lead that's gone stale (see
// runSlaJob in src/lib/jobs/sla.ts, which reads hotAgingDays every hourly pass).
export type ConversionRateConfig = {
  hotProbabilityPct: number;
  warmProbabilityPct: number;
  coldProbabilityPct: number;
  hotAgingDays: number; // HOT lead idle longer than this auto-downgrades to WARM
  // เป้า Lead อัตโนมัติ (user req 2026-07-14): the runrate page derives the
  // monthly lead target from the manager's BOOKING target × this multiplier
  // (e.g. เป้าจอง 10 × 10 = ต้องหา lead 100) instead of a second hand-typed
  // number that would drift out of sync.
  leadsPerBooking: number;
};

export const CONVERSION_RATE_DEFAULTS: ConversionRateConfig = {
  hotProbabilityPct: 20,
  warmProbabilityPct: 10,
  coldProbabilityPct: 2,
  hotAgingDays: 14,
  leadsPerBooking: 10,
};

export async function getConversionRateConfig(): Promise<ConversionRateConfig> {
  const saved = await getSetting<Partial<ConversionRateConfig>>("conversionRates");
  return { ...CONVERSION_RATE_DEFAULTS, ...saved };
}

// ── Feature switches (user req 2026-07-11) ─────────────────────────────────
// App-level on/off switches an admin flips from the settings pages — for
// features that should be hideable from staff until the back-office side is
// ready (first user: quotations — the "สร้างใบเสนอราคา" button in /chat only
// renders while this is on).
// chatSendEnabled (user req 2026-07-14): a global kill-switch for typing/
// sending free-text replies through /chat, across every brand — each staff
// text reply is a LINE push and eats the OA's monthly quota (Mitsubishi hit
// 67% of its cap in a single month from chat alone). When off, staff are
// pointed at LINE OA Manager (unlimited, but outside this app) for open-
// ended conversation; sending a quotation PDF is a separate, deliberate,
// high-value send and stays available regardless of this switch.
export type FeatureFlags = { quotationEnabled: boolean; chatSendEnabled: boolean };
const FEATURE_DEFAULTS: FeatureFlags = { quotationEnabled: false, chatSendEnabled: true };

export async function getFeatureFlags(): Promise<FeatureFlags> {
  const saved = await getSetting<Partial<FeatureFlags>>("features");
  return { ...FEATURE_DEFAULTS, ...saved };
}

export async function setFeatureFlags(patch: Partial<FeatureFlags>): Promise<FeatureFlags> {
  const next = { ...(await getFeatureFlags()), ...patch };
  await setSetting("features", next);
  return next;
}

// ── Owner-switch consent (user req 2026-07-12) ──────────────────────────────
// Controls what happens when a customer scans a DIFFERENT salesperson's QR
// for a brand they already have an active/nurture lead + owner for (see
// src/app/api/public/lead/route.ts). When enabled (default, matches the
// original 2026-07-10 behavior): the customer is asked via a LINE Flex
// message whether to keep their current salesperson or switch — ownership
// never changes silently. When disabled: no question is asked, the current
// owner is kept as-is. Either way, if the current owner is no longer active
// (left/disabled), the lead is reassigned to the newly-scanning salesperson
// automatically regardless of this setting — keeping ownership pinned to a
// departed staff member forever would strand the customer with nobody
// actually watching their lead.
export type OwnerSwitchConfig = { enabled: boolean };
const OWNER_SWITCH_DEFAULTS: OwnerSwitchConfig = { enabled: true };

export async function getOwnerSwitchConfig(): Promise<OwnerSwitchConfig> {
  const saved = await getSetting<Partial<OwnerSwitchConfig>>("ownerSwitchConsent");
  return { ...OWNER_SWITCH_DEFAULTS, ...saved };
}

export async function setOwnerSwitchConfig(patch: Partial<OwnerSwitchConfig>): Promise<OwnerSwitchConfig> {
  const next = { ...(await getOwnerSwitchConfig()), ...patch };
  await setSetting("ownerSwitchConsent", next);
  return next;
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  const rows = await prisma.setting.findMany();
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      out[row.settingKey] = row.settingValue ? JSON.parse(row.settingValue) : null;
    } catch {
      out[row.settingKey] = row.settingValue;
    }
  }
  return out;
}
