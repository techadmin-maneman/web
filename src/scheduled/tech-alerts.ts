// The cron's part in the technicians' alerts (src/domain/field/alert-sends.ts), every five minutes: the day's time to
// leave and running over; in the hour ops set for it, the next day's jobs, and the alerts older than the inbox shows
// deleted; then a push for each alert new since.

import { dropOldAlerts, pushNewAlerts, writeDayAhead, writeTimedAlerts } from "../domain/field/alert-sends.ts";
import { addDays, indiaDate, indiaTime } from "../lib/india-time.ts";
import type { CronContext } from "./cron.ts";

/** The next day's jobs, through the hour ops set; each technician's once a day, as its alert is written once. */
async function dayAhead({ env, log, inputs }: CronContext, now: Date): Promise<void> {
  const hour = Number(indiaTime(now).slice(0, 2));
  if (hour !== (await inputs()).dayAheadHour) return;
  await dropOldAlerts(env.DB, now);
  const written = await writeDayAhead(env.DB, { now, date: addDays(indiaDate(now), 1) });
  if (written > 0) log.info("day_ahead_written", { technicians: written });
}

export async function techAlertsJob(context: CronContext): Promise<void> {
  const { env, deps, log, inputs, budget } = context;
  const now = deps.now();
  const rules = async () => {
    const given = await inputs();
    return {
      unlockHour: given.addressUnlockHour,
      rules: { booking: given.bookingRules, drive: given.driveEstimate },
      leaveNoticeMin: given.leaveNoticeMin,
    };
  };
  const written = await writeTimedAlerts(env.DB, { now, rules });
  await dayAhead(context, now);
  const pushed = await pushNewAlerts(env.DB, { push: deps.push, budget, now });
  if (written + pushed > 0) log.info("tech_alerts_sent", { written, pushed });
}
