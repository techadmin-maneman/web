// The cron's part in who takes a visit (docs/decisions/0290-allotted-the-evening-before.md): each hour's re-plan of
// one of the days ahead; in the half hour before a city's lock, its tomorrow re-planned and checked on Google; and the
// evening's lock, which fixes it, just before the reminders that name the technician.

import { checkBeforeLock, lockDueDrafts, replanAhead } from "../domain/booking/allotment-lock.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import { EVENING_DRIVES, eveningCheck } from "../domain/booking/evening-check.ts";
import { createCallBudget } from "../lib/call-budget.ts";
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

/** How long a check before the lock asks Google for drives, after which the estimate stands, as the cron's calls stop. */
const EVENING_DRIVES_FOR_MS = 20_000;

const failedIn =
  (log: CronContext["log"]) =>
  (city: string, error: unknown): void => {
    log.warn("replan_failed", { city, error: error instanceof Error ? error.message : String(error) });
  };

/** One of the days ahead in turn, re-planned each hour to cut driving before its drafts are fixed. */
export async function replanDraftsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const given = await inputs();
  const moved = await replanAhead(env.DB, now, {
    replan: (city, date) => replanDay(env.DB, { city, date, now, inputs: given }),
    failed: failedIn(log),
    left: (cities) => {
      log.warn("replan_cities_left", { cities });
    },
  });
  if (moved > 0) log.info("drafts_replanned", { moved });
}

/**
 * Tomorrow fixed in each city whose reminder hour has come, whether or not messaging is on, so the reminders job runs
 * with no switch (src/scheduled/cron.ts); the reminder hours, read once if at all, for the reminders.
 */
export async function lockTomorrow({
  env,
  deps,
  inputs,
}: Pick<CronContext, "env" | "deps" | "inputs">): Promise<() => Promise<ReminderHours>> {
  const readHours = once(async () => hoursOf(env.DB, (await inputs()).reminderHour));
  await lockDueDrafts(env.DB, deps.now(), { readHours });
  return readHours;
}

/** In the half hour before a city's lock, its tomorrow re-planned, checked on Google's traffic, and re-planned again. */
export async function eveningCheckJob({ env, deps, inputs, config, log }: CronContext): Promise<void> {
  const now = deps.now();
  const drives = createCallBudget(EVENING_DRIVES, {
    until: now.getTime() + EVENING_DRIVES_FOR_MS,
    now: () => deps.now().getTime(),
  });
  const check = {
    routes: deps.routes,
    drives,
    alert: deps.alert,
    alertOnce: deps.alertOnce,
    settings: config.settings,
  };
  const city = await checkBeforeLock(env.DB, now, {
    readHours: async () => hoursOf(env.DB, (await inputs()).reminderHour),
    firstToday: (each) => takeOne(env.DB, "evening_check", each, { now, settings: config.settings }),
    check: async (each, date) => eveningCheck(env.DB, check, { city: each, date, now, inputs: await inputs() }),
    failed: failedIn(log),
  });
  if (city !== null) log.info("evening_checked", { city });
  if (drives.ranOut()) log.warn("evening_drives_spent", { drives: EVENING_DRIVES });
}
