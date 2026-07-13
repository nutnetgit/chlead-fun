import { prisma } from "@/lib/prisma";
import { linePush, buildSlaNudgeText, buildSlaEscalateBubble } from "@/lib/flex";
import { matchSlaRule } from "@/lib/sla";
import { isAutomationJobActive, getConversionRateConfig } from "@/lib/settings";

/**
 * SLA engine (hourly, in-app cron or manual POST /api/jobs/sla). Implements the
 * handoff §5 playbook: idle → nudge sales → escalate to manager → forfeit into
 * fun_lead_pool. Also checks first-response breach (createdAt → first outbound
 * activity). Every breach is logged as a fun_sla_event — "no lead falls through
 * silently" even when there's no LINE recipient to notify yet (fun_user is
 * still empty in this environment; pushes no-op safely and the event row is
 * the source of truth regardless).
 *
 * Design notes (choices not fully specified in the handoff, documented here):
 *  - "Idle" clock = last_activity_at, falling back to created_at when a lead
 *    has never had an activity logged.
 *  - Each (lead, event_type) breach is logged ONCE while unresolved — this job
 *    does not re-alert every hour once a nudge/escalate has fired; a fresh
 *    activity (last_activity_at moves past the event's detected_at) auto-
 *    resolves it as 'sales_acted' on the next run.
 *  - Cold leads have idle_forfeit_days = NULL (§5: "ไม่ริบ→nurture"). Since the
 *    handoff doesn't give an exact nurture trigger day count beyond escalate,
 *    this job moves a cold lead to status='nurture' once idle exceeds 2×
 *    idle_escalate_days (a deliberate, documented extrapolation).
 *  - Lead Aging (user req 2026-07-11, /settings/conversion-rates): a HOT lead
 *    idle past `hotAgingDays` auto-downgrades to WARM before the rest of this
 *    pass runs, so SLA thresholds/forfeit priority react to the corrected
 *    temperature. Logged as a fun_activity 'note' row, not a fun_sla_event —
 *    it's a temperature correction, not an SLA breach.
 */
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const FORFEIT_PRIORITY: Record<string, number> = { hot: 2, warm: 1, cold: 0 };

export async function runSlaJob() {
  const gate = await isAutomationJobActive("sla");
  if (!gate.active) return { ok: true, skipped: true, reason: gate.reason };

  const now = new Date();
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "";

  // ── Step 0: auto-resolve breaches where contact happened after the flag ────
  const openEvents = await prisma.slaEvent.findMany({
    where: { resolvedAt: null, eventType: { in: ["idle_nudge", "idle_escalate", "first_response_breach"] } },
    include: { lead: true },
  });
  let autoResolved = 0;
  for (const ev of openEvents) {
    const detectedAt = ev.detectedAt ?? new Date(0);
    const contactedSince =
      (ev.eventType === "first_response_breach" && ev.lead.firstResponseAt && ev.lead.firstResponseAt > detectedAt) ||
      (ev.lead.lastActivityAt && ev.lead.lastActivityAt > detectedAt);
    if (contactedSince) {
      await prisma.slaEvent.update({ where: { eventId: ev.eventId }, data: { resolvedAt: now, resolution: "sales_acted" } });
      autoResolved++;
    }
  }

  // ── Load rules + active leads + user directory (once, reused per lead) ────
  const rules = await prisma.slaRule.findMany({ where: { isActive: 1 } });
  const users = await prisma.funUser.findMany({ where: { isActive: 1 } });
  const userById = new Map(users.map((u) => [u.userId, u]));
  const managersByBranch = new Map<number, typeof users>();
  for (const u of users) {
    if (u.role !== "manager" && u.role !== "gm") continue;
    if (u.branchId === null) continue;
    managersByBranch.set(u.branchId, [...(managersByBranch.get(u.branchId) ?? []), u]);
  }

  const leads = await prisma.lead.findMany({
    where: { status: "active" },
    include: { channel: true, person: true, brand: true, branch: true },
  });

  // Still-unresolved events per lead (avoid re-firing while one is open).
  const unresolvedByLead = new Map<string, Set<string>>();
  const stillOpen = await prisma.slaEvent.findMany({ where: { resolvedAt: null } });
  for (const ev of stillOpen) {
    const key = String(ev.leadId);
    unresolvedByLead.set(key, (unresolvedByLead.get(key) ?? new Set()).add(ev.eventType));
  }

  const conversionRates = await getConversionRateConfig();

  let nudged = 0, escalated = 0, forfeited = 0, nurtured = 0, firstResponseFlagged = 0, agedDown = 0;
  const errors: string[] = [];

  for (const lead of leads) {
    try {
      // Booking = the pipeline's finish line (user decision 2026-07-13: the
      // lead system ends at จอง, no "delivered" stage). A booked lead is a
      // win — never nudge/escalate/forfeit it; the booking auto-archive
      // below is the only thing that still applies.
      if (lead.stage === "booking") continue;

      // ── Lead Aging (user req 2026-07-11): buying intent decays with time —
      // a HOT lead idle past hotAgingDays auto-downgrades to WARM so it stops
      // skewing the Weighted Pipeline forecast and SLA urgency. Computed here
      // (before rule matching) so the rest of this pass — SLA thresholds,
      // forfeit priority — reacts to the corrected temperature.
      let temperature = lead.temperature;
      if (temperature === "hot") {
        const agingAnchor = lead.lastActivityAt ?? lead.createdAt ?? now;
        const agingDays = (now.getTime() - agingAnchor.getTime()) / DAY;
        if (agingDays >= conversionRates.hotAgingDays) {
          await prisma.$transaction([
            prisma.lead.update({ where: { leadId: lead.leadId }, data: { temperature: "warm" } }),
            prisma.activity.create({
              data: {
                leadId: lead.leadId, activityType: "note", direction: "internal",
                summary: "ระบบลดระดับความสนใจอัตโนมัติ (HOT → WARM)",
                detail: `ไม่มีความเคลื่อนไหว ${Math.floor(agingDays)} วัน เกินเกณฑ์ ${conversionRates.hotAgingDays} วัน (ตั้งค่าใน /settings/conversion-rates)`,
              },
            }),
          ]);
          temperature = "warm";
          agedDown++;
        }
      }

      const rule = matchSlaRule(rules, {
        brandId: lead.brandId, branchId: lead.branchId,
        temperature, channelCategory: lead.channel.category,
      });
      if (!rule) continue;
      const open = unresolvedByLead.get(String(lead.leadId)) ?? new Set<string>();

      // ── First-response breach ──────────────────────────────────────────
      if (!lead.firstResponseAt && rule.firstResponseMinutes && !open.has("first_response_breach")) {
        const minutesWaiting = (now.getTime() - (lead.createdAt?.getTime() ?? now.getTime())) / MIN;
        if (minutesWaiting > rule.firstResponseMinutes) {
          await prisma.slaEvent.create({
            data: { leadId: lead.leadId, ruleId: rule.ruleId, eventType: "first_response_breach", notifiedTo: lead.ownerUserId },
          });
          const owner = lead.ownerUserId ? userById.get(lead.ownerUserId) : null;
          if (owner?.lineUserid && lineToken) {
            await linePush(lineToken, owner.lineUserid, [
              { type: "text", text: `🚨 ยังไม่ตอบลูกค้าใหม่!\nLead #${Number(lead.leadId)} — ${lead.person.nickname || lead.person.firstName || "ไม่ระบุชื่อ"}\nเกินเวลาตอบสนองครั้งแรกแล้ว (${rule.firstResponseMinutes} นาที) กรุณาติดต่อด่วน` },
            ]);
          }
          firstResponseFlagged++;
        }
      }

      // ── Idle ladder (forfeit > escalate > nudge, most severe first) ────
      const idleAnchor = lead.lastActivityAt ?? lead.createdAt ?? now;
      const idleDays = (now.getTime() - idleAnchor.getTime()) / DAY;

      if (rule.idleForfeitDays !== null && idleDays >= rule.idleForfeitDays) {
        // Forfeit — return to the pool, log history, resolve any open ladder events.
        await prisma.$transaction([
          prisma.lead.update({ where: { leadId: lead.leadId }, data: { status: "forfeited", stage: "forfeited", ownerUserId: null } }),
          prisma.leadPool.create({
            data: { leadId: lead.leadId, enteredReason: "forfeited", priority: FORFEIT_PRIORITY[temperature ?? "cold"] ?? 0 },
          }),
          prisma.assignmentHistory.create({
            data: { leadId: lead.leadId, fromUserId: lead.ownerUserId, toUserId: null, reason: "forfeit_reassign", assignedBy: null },
          }),
          prisma.slaEvent.create({ data: { leadId: lead.leadId, ruleId: rule.ruleId, eventType: "idle_forfeit", detectedAt: now } }),
        ]);
        for (const type of ["idle_nudge", "idle_escalate"] as const) {
          if (open.has(type)) {
            const ev = openEvents.find((e) => e.leadId === lead.leadId && e.eventType === type)
              ?? await prisma.slaEvent.findFirst({ where: { leadId: lead.leadId, eventType: type, resolvedAt: null } });
            if (ev) await prisma.slaEvent.update({ where: { eventId: ev.eventId }, data: { resolvedAt: now, resolution: "returned_to_pool" } });
          }
        }
        forfeited++;
        continue; // lead left 'active' status — nothing else to evaluate this pass
      }

      if (rule.idleForfeitDays === null && rule.idleEscalateDays !== null && idleDays >= rule.idleEscalateDays * 2) {
        // Cold, no forfeit threshold defined (§5) — nurture instead of forfeiting.
        await prisma.lead.update({ where: { leadId: lead.leadId }, data: { status: "nurture", stage: "nurture" } });
        nurtured++;
        continue;
      }

      if (rule.idleEscalateDays !== null && idleDays >= rule.idleEscalateDays && !open.has("idle_escalate")) {
        await prisma.slaEvent.create({
          data: { leadId: lead.leadId, ruleId: rule.ruleId, eventType: "idle_escalate", notifiedTo: lead.ownerUserId },
        });
        const managers = managersByBranch.get(lead.branchId) ?? [];
        const owner = lead.ownerUserId ? userById.get(lead.ownerUserId) : null;
        if (lineToken && managers.length) {
          const { altText, contents } = buildSlaEscalateBubble({
            leadId: Number(lead.leadId), brand: lead.brand.brandName, branchCode: lead.branch.branchCode ?? lead.branch.branchName,
            customerName: lead.person.nickname || lead.person.firstName,
            ownerName: owner?.displayName, daysIdle: Math.floor(idleDays), temperature,
          });
          for (const mgr of managers) {
            if (mgr.lineUserid) await linePush(lineToken, mgr.lineUserid, [{ type: "flex", altText, contents }]);
          }
        }
        escalated++;
      } else if (rule.idleNudgeDays !== null && idleDays >= rule.idleNudgeDays && !open.has("idle_nudge")) {
        await prisma.slaEvent.create({
          data: { leadId: lead.leadId, ruleId: rule.ruleId, eventType: "idle_nudge", notifiedTo: lead.ownerUserId },
        });
        const owner = lead.ownerUserId ? userById.get(lead.ownerUserId) : null;
        if (owner?.lineUserid && lineToken) {
          await linePush(lineToken, owner.lineUserid, [
            { type: "text", text: buildSlaNudgeText({ leadId: Number(lead.leadId), customerName: lead.person.nickname || lead.person.firstName, daysIdle: Math.floor(idleDays) }) },
          ]);
        }
        nudged++;
      }
    } catch (e) {
      console.error(`[sla] lead ${Number(lead.leadId)}:`, e);
      errors.push(`${Number(lead.leadId)}:${String(e).slice(0, 100)}`);
    }
  }

  // ── Auto-archive (CATS candidate parity): leads in a terminal status
  // (lost/forfeited/won) go quiet — soft-archive them 30 days after their last
  // activity so they stop cluttering the working views. Never deleted; kept
  // for historical/compliance lookup, un-archivable manually if needed.
  // 'nurture' is excluded — still a live re-engagement candidate, not terminal.
  const ARCHIVE_AFTER_DAYS = 30;
  const archiveCutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY);
  const archivable = await prisma.lead.findMany({
    where: { archivedAt: null, status: { in: ["lost", "forfeited", "won"] } },
    select: { leadId: true, lastActivityAt: true, createdAt: true },
  });
  const toArchive = archivable
    .filter((l) => (l.lastActivityAt ?? l.createdAt ?? now) <= archiveCutoff)
    .map((l) => l.leadId);
  if (toArchive.length) {
    await prisma.lead.updateMany({ where: { leadId: { in: toArchive } }, data: { archivedAt: now } });
  }

  // ── Booking auto-archive (user req 2026-07-13): the lead system ends at
  // จอง — a booked lead stays visible on the board for 5 days (so the team
  // sees the win), then moves to the archive so จองแล้ว cards don't pile up
  // forever. Anchor = when the lead ENTERED booking (latest stage-history
  // row), not last activity — chatter after booking shouldn't keep it on
  // the board. Never deleted; still counted in reports via stage history.
  const BOOKING_ARCHIVE_DAYS = 5;
  const bookingCutoff = new Date(now.getTime() - BOOKING_ARCHIVE_DAYS * DAY);
  const bookedLeads = await prisma.lead.findMany({
    where: { archivedAt: null, stage: "booking" },
    select: { leadId: true, createdAt: true },
  });
  let bookingArchived = 0;
  if (bookedLeads.length) {
    const histories = await prisma.leadStageHistory.findMany({
      where: { leadId: { in: bookedLeads.map((l) => l.leadId) }, toStage: "booking" },
      orderBy: { changedAt: "desc" },
    });
    const enteredBookingAt = new Map<string, Date>();
    for (const h of histories) {
      const key = String(h.leadId);
      if (!enteredBookingAt.has(key) && h.changedAt) enteredBookingAt.set(key, h.changedAt);
    }
    const toArchiveBooked = bookedLeads
      .filter((l) => (enteredBookingAt.get(String(l.leadId)) ?? l.createdAt ?? now) <= bookingCutoff)
      .map((l) => l.leadId);
    if (toArchiveBooked.length) {
      await prisma.lead.updateMany({ where: { leadId: { in: toArchiveBooked } }, data: { archivedAt: now } });
      bookingArchived = toArchiveBooked.length;
    }
  }

  return {
    ok: true, checked: leads.length, autoResolved,
    firstResponseFlagged, nudged, escalated, forfeited, nurtured, agedDown,
    archived: toArchive.length, bookingArchived,
    errors: errors.length ? errors : undefined,
  };
}
