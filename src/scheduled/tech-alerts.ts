// The cron's part in the technicians' alerts (src/domain/field/alert-sends.ts): every five minutes, the day's time to
// leave and running over, then a push for each alert new since; at 8 pm in India, the next day's jobs, and the alerts
// older than the inbox shows deleted.

import { dropOldAlerts, pushNewAlerts, writeDayAhead, writeTimedAlerts } from "../domain/field/alert-sends.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import type { CronContext } from "./cron.ts";

export async function techAlertsJob({ env, deps, log, inputs, budget }: CronContext): Promise<void> {
  const now = deps.now();
  const rules = async () => {
    const given = await inputs();
    return {
      unlockHour: given.addressUnlockHour,
      rules: { booking: given.bookingRules, drive: given.driveEstimate },
    };
  };
  const written = await writeTimedAlerts(env.DB, { now, rules });
  const pushed = await pushNewAlerts(env.DB, { push: deps.push, budget, now });
  if (written + pushed > 0) log.info("tech_alerts_sent", { written, pushed });
}

/** The day ahead, for the slot's evening; a slot caught up after midnight sends nothing, its tomorrow being today. */
export async function dayAheadJob({ env, deps, log, slot }: CronContext): Promise<void> {
  const now = deps.now();
  await dropOldAlerts(env.DB, now);
  const today = indiaDate(now);
  if (slot?.date !== today) return;
  const written = await writeDayAhead(env.DB, { now, date: addDays(today, 1) });
  if (written > 0) log.info("day_ahead_written", { technicians: written });
}
