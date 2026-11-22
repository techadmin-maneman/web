// The cron's part in who takes a visit (docs/decisions/0290-allotted-the-evening-before.md): the night's re-plan of
// the drafts in the days ahead, and the evening's lock, which re-plans tomorrow in each city whose reminder hour has
// come and then fixes it, just before the reminders that name the technician.

import { lockDueDrafts, replanAhead } from "../domain/booking/allotment-lock.ts";
import { eveningCheck } from "../domain/booking/evening-check.ts";
import { replanDay } from "../domain/booking/replan-day.ts";
import { cityReminderHours, type ReminderHours } from "../domain/cities/city-rules.ts";
import type { CronContext } from "./cron.ts";

/** The reminder hour, with the hours of the cities that set their own (src/domain/cities/city-rules.ts). */
export async function hoursOf(db: D1Database, national: number): Promise<ReminderHours> {
  return { national, cities: await cityReminderHours(db) };
}

/** A read made once, the first time it is asked for, and only then: the reminder hours the lock and reminders share. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let made: Promise<T> | undefined;
  return () => (made ??= read());
}

/** The night's re-plan of every draft in the days ahead, to cut driving before each is fixed. */
export async function replanDraftsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const given = await inputs();
  const moved = await replanAhead(env.DB, now, (city, date) => replanDay(env.DB, { city, date, now, inputs: given }));
  if (moved > 0) log.info("drafts_replanned", { moved });
}

/**
 * Tomorrow re-planned and fixed in each city whose reminder hour has come, whether or not messaging is on, so the
 * reminders job runs with no switch (src/scheduled/cron.ts); the reminder hours, read once if at all, for the reminders.
 */
export async function lockTomorrow({ env, deps, inputs, config }: CronContext): Promise<() => Promise<ReminderHours>> {
  const now = deps.now();
  const readHours = once(async () => hoursOf(env.DB, (await inputs()).reminderHour));
  const check = { routes: deps.routes, alert: deps.alert, alertOnce: deps.alertOnce, settings: config.settings };
  await lockDueDrafts(env.DB, now, {
    readHours,
    // Re-planned on the estimate, checked on Google's traffic, and re-planned once more where it falls short.
    replan: async (city, date) => eveningCheck(env.DB, check, { city, date, now, inputs: await inputs() }),
  });
  return readHours;
}
