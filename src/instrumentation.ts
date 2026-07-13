/**
 * In-app scheduler (user req 2026-07-08): replaces n8n as the cron trigger for
 * the score/nudge/digest/SLA jobs. Each job function self-gates on the
 * enabled-toggle + configured hour already stored via /settings/automation
 * (see src/lib/settings.ts isAutomationJobActive) — this is a single hourly
 * tick that calls all four; nothing about the gating logic changes, only who
 * triggers it. n8n keeps only the FB Lead Ads webhook intake (no in-app
 * equivalent yet).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const g = globalThis as unknown as { __funCronStarted?: boolean };
  if (g.__funCronStarted) return; // guard against re-registration on hot reload
  g.__funCronStarted = true;

  const cron = await import("node-cron");
  const { runSlaJob } = await import("@/lib/jobs/sla");
  const { runScoreJob } = await import("@/lib/jobs/score");
  const { runNudgeJob } = await import("@/lib/jobs/nudge");
  const { runDigestJob } = await import("@/lib/jobs/digest");

  cron.schedule("0 * * * *", async () => {
    for (const job of [runSlaJob, runScoreJob, runNudgeJob, runDigestJob]) {
      try {
        const result = await job();
        console.log(`[scheduler] ${job.name}`, result);
      } catch (e) {
        console.error(`[scheduler] ${job.name} failed`, e);
      }
    }
  });

  console.log("[scheduler] in-app hourly cron registered");
}
