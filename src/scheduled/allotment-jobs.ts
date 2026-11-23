// The cron's part in who takes a visit (docs/decisions/0290-allotted-the-evening-before.md): each hour's re-plan of
// one of the days ahead; in the half hour before a city's lock, its tomorrow re-planned and checked on Google; the
// evening's lock, which fixes it, just before the reminders that name the technician; and each night, the drive times
// learned from the drives done.

import { checkBeforeLock, lockDueDrafts, replanAhead } from "../domain/booking/allotment-lock.ts";
import { takeOne } from "../domain/sign-in/rate-limit.ts";
import { EVENING_DRIVES, eveningCheck } from "../domain/booking/evening-check.ts";
import { learnDrives } from "../domain/booking/learn-drives.ts";
import { ALERT_WORDS } from "../config/alert-words.ts";
import { createCallBudget } from "../lib/call-budget.ts";
import { replanDay, tellStranded } from "../domain/booking/replan-day.ts";
import { cityReminderHours, type ReminderHours } from "../domain/cities/city-rules.ts";
import type { CronContext, CronJob } from "./cron.ts";

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

/** A city whose drafts on a day could not be re-planned: logged with why, and Operations told once for that day. */
export const failedIn =
  ({ log, deps }: Pick<CronContext, "log" | "deps">) =>
  async (city: string, date: string, error: unknown): Promise<void> => {
    log.warn("replan_failed", { city, date, error: error instanceof Error ? error.message : String(error) });
    await deps.alertOnce({
      key: `replan_failed:${city}:${date}`,
      message: ALERT_WORDS.replan_failed({ city, day: date }),
      link: "/dispatch",
    });
  };

/** One of the days ahead in turn, re-planned each hour to cut driving before its drafts are fixed. */
async function replanDraftsJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const now = deps.now();
  const given = await inputs();
  const moved = await replanAhead(env.DB, now, {
    readHours: () => hoursOf(env.DB, given.reminderHour),
    replan: async (city, date) => {
      const { moved, stranded } = await replanDay(env.DB, { city, date, now, inputs: given });
      await tellStranded(env.DB, deps.alertOnce, { date, stranded });
      return moved;
    },
    failed: failedIn({ log, deps }),
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

/**
 * In the half hour before a city's lock, its tomorrow re-planned, checked on Google's traffic, and re-planned again;
 * each city with its own drives to ask, however many a run checks.
 */
export async function eveningCheckJob({ env, deps, inputs, config, log }: CronContext): Promise<void> {
  const now = deps.now();
  const checkCity = async (city: string, date: string) => {
    const drives = createCallBudget(EVENING_DRIVES, {
      until: deps.now().getTime() + EVENING_DRIVES_FOR_MS,
      now: () => deps.now().getTime(),
    });
    const check = {
      routes: deps.routes,
      drives,
      alert: deps.alert,
      alertOnce: deps.alertOnce,
      settings: config.settings,
    };
    await eveningCheck(env.DB, check, { city, date, now, inputs: await inputs() });
    if (drives.ranOut()) log.warn("evening_drives_spent", { city, drives: EVENING_DRIVES });
  };
  const cities = await checkBeforeLock(env.DB, now, {
    readHours: async () => hoursOf(env.DB, (await inputs()).reminderHour),
    firstToday: (each) => takeOne(env.DB, "evening_check", each, { now, settings: config.settings }),
    check: checkCity,
    failed: failedIn({ log, deps }),
  });
  if (cities.length > 0) log.info("evening_checked", { cities });
}

/** Each night, every city's drive times learned afresh from the weeks of drives ops set. */
async function learnDrivesJob({ env, deps, log, inputs }: CronContext): Promise<void> {
  const given = await inputs();
  const learned = await learnDrives(env.DB, {
    now: deps.now(),
    learning: given.driveLearning,
    estimate: given.driveEstimate,
    booking: given.bookingRules,
  });
  log.info("drives_learned", learned);
}

/** The allotment's hourly jobs, in the cron's table (./cron.ts): the re-plan, and the night's learning from 2 am. */
export const ALLOTMENT_HOURLY: readonly CronJob[] = [
  { name: "replan_drafts", needs: "nothing", every: 60, at: 20, run: replanDraftsJob },
  { name: "learn_drives", needs: "nothing", every: 60, at: 37, slot: { hour: 2 }, run: learnDrivesJob },
];
