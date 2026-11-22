// When a visit's technician is fixed (docs/decisions/0290-allotted-the-evening-before.md): a visit is booked with a
// draft technician the booking engine may change, and fixed at the reminder hour of the evening before, when the
// client is told who is coming and the technician's card opens. A visit booked for today, or for tomorrow once that
// hour has come in its city, is fixed at once.

import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { hourHasCome } from "../../policy/city-settings.ts";
import { cityReminderHours, reminderHourCame, type ReminderHours } from "../cities/city-rules.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";
import { fixingDrafts } from "../visits/technician-draft.ts";
import { boardMoved } from "../visits/visit-upkeep.ts";

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
 * unless ops chose who.
 */
export async function holdDraft(db: D1Database, holdId: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT h.technician_chosen, h.starts_at, sp.city,
              (SELECT a.technician_draft FROM appointments a WHERE a.id = h.appointment_id) AS visit_draft
       FROM slot_holds h LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<{ technician_chosen: number; starts_at: string | null; city: string | null; visit_draft: number | null }>();
  if (row === null) return false;
  if (row.visit_draft !== null) return row.visit_draft === 1;
  if (row.technician_chosen === 1 || row.starts_at === null) return false;
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
  return hourHasCome(lockHourOf({ national: day.nationalHour, cities }, technician?.city ?? null), day.now);
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
 * tomorrow, and the reminder hours only when one does. Each city whose hour has come has tomorrow re-planned first, so
 * what is fixed is the plan that costs least (./replan-day.ts).
 */
export async function lockDueDrafts(
  db: D1Database,
  now: Date,
  deps: {
    readonly readHours: () => Promise<ReminderHours>;
    readonly replan: (city: string, date: string) => Promise<unknown>;
    /** A city whose re-plan failed: told, and left as it stands, so the lock still fixes it. */
    readonly failed: (city: string, error: unknown) => void;
  },
): Promise<void> {
  const today = indiaDate(now);
  const tomorrow = addDays(today, 1);
  const { results: due } = await db
    .prepare(
      `SELECT DISTINCT service_city AS city, window_start >= ?1 AS tomorrow FROM appointments
       WHERE technician_draft = 1 AND window_start < ?2`,
    )
    .bind(indiaInstant(tomorrow, "00:00").toISOString(), indiaInstant(addDays(today, 2), "00:00").toISOString())
    .all<{ city: string | null; tomorrow: number }>();
  if (due.length === 0) return;
  const hours = await deps.readHours();
  for (const city of new Set(due.flatMap((row) => (row.tomorrow === 1 && row.city !== null ? [row.city] : [])))) {
    if (!hourHasCome(lockHourOf(hours, city), now)) continue;
    try {
      await deps.replan(city, tomorrow);
    } catch (error) {
      deps.failed(city, error);
    }
  }
  // The board's version goes up with it, so an open board stops calling the visits drafts.
  await db.batch([lockDrafts(db, now, hours), boardMoved(db)]);
}

/** The days ahead the night's re-plan looks over: tomorrow and the week after it. */
const REPLAN_DAYS = 7;

/** Every city and day with drafts in the days ahead, each re-planned (./replan-day.ts); how many drafts moved. */
export async function replanAhead(
  db: D1Database,
  now: Date,
  deps: {
    readonly replan: (city: string, date: string) => Promise<number>;
    readonly failed: (city: string, error: unknown) => void;
  },
): Promise<number> {
  const today = indiaDate(now);
  const { results } = await db
    .prepare(
      `SELECT DISTINCT service_city AS city, window_start FROM appointments
       WHERE technician_draft = 1 AND window_start >= ?1 AND window_start < ?2 AND service_city IS NOT NULL`,
    )
    .bind(
      indiaInstant(addDays(today, 1), "00:00").toISOString(),
      indiaInstant(addDays(today, REPLAN_DAYS + 1), "00:00").toISOString(),
    )
    .all<{ city: string; window_start: string }>();
  const cityDays = new Set(results.map((row) => `${row.city}|${indiaDate(new Date(row.window_start))}`));
  let moved = 0;
  for (const key of cityDays) {
    const [city = "", date = ""] = key.split("|");
    try {
      moved += await deps.replan(city, date);
    } catch (error) {
      deps.failed(city, error);
    }
  }
  return moved;
}
