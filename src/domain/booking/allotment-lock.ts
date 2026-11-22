// When a visit's technician is fixed (docs/decisions/0290-allotted-the-evening-before.md): a visit is booked with a
// draft technician the booking engine may change, and fixed at the reminder hour of the evening before, when the
// client is told who is coming and the technician's card opens. A visit booked for today, or for tomorrow once that
// hour has come in its city, is fixed at once.

import { addDays, indiaDate, indiaInstant, indiaTime } from "../../lib/india-time.ts";
import { hourHasCome } from "../../policy/city-settings.ts";
import { cityReminderHours, reminderHourCame, type ReminderHours } from "../cities/city-rules.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";
import { fixingDrafts } from "../visits/technician-draft.ts";
import { boardMoved } from "../visits/visit-upkeep.ts";

/**
 * Whether a draft on India's `date` in `city` is left to the evening's check and lock, so nothing else moves it: one of
 * today's or before, or tomorrow's once the half hour before its city's lock has begun (./evening-check.ts).
 */
export function leftToTheLock(
  hours: ReminderHours,
  at: { readonly city: string | null; readonly date: string },
  now: Date,
) {
  const today = indiaDate(now);
  if (at.date <= today) return true;
  if (at.date !== addDays(today, 1)) return false;
  return hourHasCome(lockHourOf(hours, at.city), new Date(now.getTime() + CHECK_BEFORE_LOCK_MINUTES * 60_000));
}

/** The reminder hour in force, the nation's and each city's own, as the evening's lock and its reminders read it. */
export async function reminderHoursAt(db: D1Database, now: Date): Promise<ReminderHours> {
  const [inputs, cities] = await Promise.all([readOpsInputs(db, now), cityReminderHours(db)]);
  return { national: inputs.reminderHour, cities };
}

/** The hour the evening before a visit in `city` is fixed at: the city's own reminder hour, else the national one. */
function lockHourOf(hours: ReminderHours, city: string | null): number {
  if (typeof hours === "number") return hours;
  return (city === null ? undefined : hours.cities.get(city)) ?? hours.national;
}

/** Whether a visit starting at `start` in `city`, booked `now`, is booked with a draft technician. */
export function bookedAsDraft(start: Date, city: string | null, now: Date, hours: ReminderHours): boolean {
  const today = indiaDate(now);
  const day = indiaDate(start);
  if (day <= today) return false;
  if (day === addDays(today, 1)) return !hourHasCome(lockHourOf(hours, city), now);
  return true;
}

/**
 * Whether a hold's visit is with a draft technician: as its visit stands once booked; before, by when it starts,
 * unless ops chose who or it moves a visit already fixed (./move-in-place.ts).
 */
export async function holdDraft(db: D1Database, holdId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT h.technician_chosen, h.starts_at, sp.city,
              (SELECT a.technician_draft FROM appointments a WHERE a.id = h.appointment_id) AS visit_draft,
              (SELECT m.technician_draft FROM appointments m WHERE m.id = h.moves_appointment_id) AS moving_draft
       FROM slot_holds h LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<{
      technician_chosen: number;
      starts_at: string | null;
      city: string | null;
      visit_draft: number | null;
      moving_draft: number | null;
    }>();
  if (row === null) return false;
  if (row.visit_draft !== null) return row.visit_draft === 1;
  if (row.technician_chosen === 1 || row.moving_draft === 0 || row.starts_at === null) return false;
  return bookedAsDraft(new Date(row.starts_at), row.city, now, await reminderHoursAt(db, now));
}

/**
 * Whether a technician's list for `date` stands as the evening's lock leaves it: any day up to today, and tomorrow once
 * the reminder hour of the technician's city has come. A later day may still be given visits that are drafts now.
 */
export async function daySettled(
  db: D1Database,
  day: { readonly technicianId: string; readonly date: string; readonly now: Date; readonly nationalHour: number },
): Promise<boolean> {
  const today = indiaDate(day.now);
  if (day.date <= today) return true;
  if (day.date !== addDays(today, 1)) return false;
  const [cities, technician] = await Promise.all([
    cityReminderHours(db),
    db.prepare("SELECT city FROM technicians WHERE id = ?1").bind(day.technicianId).first<{ city: string | null }>(),
  ]);
  const city = technician?.city ?? null;
  if (!hourHasCome(lockHourOf({ national: day.nationalHour, cities }, city), day.now)) return false;
  // The hour has come, but the lock runs a minute into it, after the day's re-plan and Google's check.
  return !(await draftsLeftIn(db, { city, date: day.date }));
}

/** Whether a city's day still has a draft: the evening's lock has not yet run for it. */
async function draftsLeftIn(
  db: D1Database,
  day: { readonly city: string | null; readonly date: string },
): Promise<boolean> {
  const left = await db
    .prepare(
      `SELECT 1 AS left FROM appointments
       WHERE technician_draft = 1 AND window_start >= ?1 AND window_start < ?2 AND service_city IS ?3 LIMIT 1`,
    )
    .bind(
      indiaInstant(day.date, "00:00").toISOString(),
      indiaInstant(addDays(day.date, 1), "00:00").toISOString(),
      day.city,
    )
    .first();
  return left !== null;
}

/**
 * Fixes the draft technicians of tomorrow's visits in every city whose reminder hour has come, and of any visit already
 * today. Run before the evening's reminders, which name the technician.
 */
export function lockDrafts(db: D1Database, now: Date, hours: ReminderHours): D1PreparedStatement {
  const today = indiaDate(now);
  return fixingDrafts(db, {
    tomorrow: indiaInstant(addDays(today, 1), "00:00").toISOString(),
    after: indiaInstant(addDays(today, 2), "00:00").toISOString(),
    came: reminderHourCame("service_city", 3, hours, now),
  });
}

/**
 * The evening's lock as the cron runs it: nothing read but the drafts' index while no draft falls before the day after
 * tomorrow, the reminder hours only when one does, and nothing written until one is due. What it fixes is the plan as
 * the half hour before left it (checkBeforeLock), however much of that was done.
 */
export async function lockDueDrafts(
  db: D1Database,
  now: Date,
  deps: { readonly readHours: () => Promise<ReminderHours> },
): Promise<void> {
  const today = indiaDate(now);
  const { results: due } = await db
    .prepare(
      `SELECT DISTINCT service_city AS city, window_start >= ?1 AS tomorrow FROM appointments
       WHERE technician_draft = 1 AND window_start < ?2`,
    )
    .bind(
      indiaInstant(addDays(today, 1), "00:00").toISOString(),
      indiaInstant(addDays(today, 2), "00:00").toISOString(),
    )
    .all<{ city: string | null; tomorrow: number }>();
  if (due.length === 0) return;
  const hours = await deps.readHours();
  // Due: one already today, its evening's lock missed, or tomorrow's in a city whose hour has come.
  if (!due.some((row) => row.tomorrow === 0 || hourHasCome(lockHourOf(hours, row.city), now))) return;
  // The board's version goes up with it, so an open board stops calling the visits drafts.
  await db.batch([lockDrafts(db, now, hours), boardMoved(db)]);
}

/** How long before a city's lock its tomorrow is re-planned and checked on Google, a city at a time. */
const CHECK_BEFORE_LOCK_MINUTES = 30;

/**
 * Tomorrow in the next city whose lock is due within CHECK_BEFORE_LOCK_MINUTES, re-planned and checked on Google
 * (./evening-check.ts), each city once a day: one city a run, so a run's statements stay few; the city checked, or
 * null. Nothing is read outside the last half hour before an hour, when no lock is near.
 */
export async function checkBeforeLock(
  db: D1Database,
  now: Date,
  deps: {
    readonly readHours: () => Promise<ReminderHours>;
    /** Whether this is the city's first check today; true takes it. */
    readonly firstToday: (city: string) => Promise<boolean>;
    readonly check: (city: string, date: string) => Promise<unknown>;
    /** A city whose check failed: told, and left as the hourly re-plan planned it, which the lock then fixes. */
    readonly failed: (city: string, date: string, error: unknown) => Promise<void> | void;
  },
): Promise<string | null> {
  if (Number(indiaTime(now).slice(3, 5)) < 60 - CHECK_BEFORE_LOCK_MINUTES) return null;
  const tomorrow = addDays(indiaDate(now), 1);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT service_city AS city FROM appointments
       WHERE technician_draft = 1 AND window_start >= ?1 AND window_start < ?2 AND service_city IS NOT NULL
       ORDER BY service_city`,
    )
    .bind(indiaInstant(tomorrow, "00:00").toISOString(), indiaInstant(addDays(tomorrow, 1), "00:00").toISOString())
    .all<{ city: string }>();
  if (results.length === 0) return null;
  const hours = await deps.readHours();
  const soon = new Date(now.getTime() + CHECK_BEFORE_LOCK_MINUTES * 60_000);
  for (const { city } of results) {
    const hour = lockHourOf(hours, city);
    if (hourHasCome(hour, now) || !hourHasCome(hour, soon)) continue;
    if (!(await deps.firstToday(city))) continue;
    try {
      await deps.check(city, tomorrow);
    } catch (error) {
      await deps.failed(city, tomorrow, error);
    }
    return city;
  }
  return null;
}

/** The days ahead the hourly re-plan looks over, one in turn: tomorrow and the six after it. */
const REPLAN_DAYS = 7;

/**
 * The most cities one hour's re-plan takes on, each costing tens of statements; a day's next turn takes the cities after
 * them, round again, so each has a turn. A day has three or four turns a day.
 */
const REPLAN_CITIES = 3;

/** The turns a day ahead is sure of each day: every seventh hour from its own, at least three. */
const TURNS_A_DAY = 3;

/**
 * The day ahead this hour re-plans: tomorrow at midnight, the day after at 1 am, and so on round the week, so each day
 * is re-planned three or four times a day and a run's statements stay few.
 */
export const replanDateAt = (now: Date): string =>
  addDays(indiaDate(now), 1 + (Number(indiaTime(now).slice(0, 2)) % REPLAN_DAYS));

/**
 * The cities this turn takes of those with drafts: REPLAN_CITIES of them, from where the day's turns before it left off,
 * round again.
 */
function turnOf(cities: readonly string[], now: Date): string[] {
  const turn = Math.floor(Number(indiaTime(now).slice(0, 2)) / REPLAN_DAYS);
  const from = (turn * REPLAN_CITIES) % Math.max(cities.length, 1);
  return [...cities.slice(from), ...cities.slice(0, from)].slice(0, REPLAN_CITIES);
}

/**
 * This hour's day ahead in the turn's cities with drafts on it, re-planned; how many drafts moved. Tomorrow in a city
 * whose check before the lock has begun is left to it, which knows Google's word (checkBeforeLock).
 */
export async function replanAhead(
  db: D1Database,
  now: Date,
  deps: {
    readonly readHours: () => Promise<ReminderHours>;
    readonly replan: (city: string, date: string) => Promise<number>;
    readonly failed: (city: string, date: string, error: unknown) => Promise<void> | void;
    /** More cities than a day's turns take: some are never re-planned that day. */
    readonly left: (cities: readonly string[]) => void;
  },
): Promise<number> {
  const date = replanDateAt(now);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT service_city AS city FROM appointments
       WHERE technician_draft = 1 AND window_start >= ?1 AND window_start < ?2 AND service_city IS NOT NULL
       ORDER BY service_city`,
    )
    .bind(indiaInstant(date, "00:00").toISOString(), indiaInstant(addDays(date, 1), "00:00").toISOString())
    .all<{ city: string }>();
  let cities = results.map((row) => row.city);
  if (date === addDays(indiaDate(now), 1) && cities.length > 0) {
    const hours = await deps.readHours();
    const soon = new Date(now.getTime() + CHECK_BEFORE_LOCK_MINUTES * 60_000);
    cities = cities.filter((city) => !hourHasCome(lockHourOf(hours, city), soon));
  }
  let moved = 0;
  for (const city of turnOf(cities, now)) {
    try {
      moved += await deps.replan(city, date);
    } catch (error) {
      await deps.failed(city, date, error);
    }
  }
  if (cities.length > REPLAN_CITIES * TURNS_A_DAY) deps.left(cities.slice(REPLAN_CITIES * TURNS_A_DAY));
  return moved;
}
