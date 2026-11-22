// When a visit's technician is fixed (docs/decisions/0290-allotted-the-evening-before.md): a visit is booked with a
// draft technician the booking engine may change, and fixed at the reminder hour of the evening before, when the
// client is told who is coming and the technician's card opens. A visit booked for today, or for tomorrow once that
// hour has come in its city, is fixed at once.

import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { hourHasCome } from "../../policy/city-settings.ts";
import { cityReminderHours, reminderHourCame, type ReminderHours } from "../cities/city-rules.ts";
import { readOpsInputs } from "../platform/ops-settings.ts";

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
 * Fixes the draft technicians of tomorrow's visits in every city whose reminder hour has come, and of any visit already
 * today. Run before the evening's reminders, which name the technician.
 */
export function lockDrafts(db: D1Database, now: Date, hours: ReminderHours): D1PreparedStatement {
  const today = indiaDate(now);
  const tomorrow = indiaInstant(addDays(today, 1), "00:00").toISOString();
  const after = indiaInstant(addDays(today, 2), "00:00").toISOString();
  const came = reminderHourCame("service_city", 3, hours, now);
  return db
    .prepare(
      `UPDATE appointments SET technician_draft = 0
       WHERE technician_draft = 1 AND window_start < ?2
         AND (window_start < ?1 OR ${came === null ? "0" : came.sql})`,
    )
    .bind(tomorrow, after, ...(came?.values ?? []));
}

/**
 * The evening's lock as the cron runs it: nothing read but the drafts' index while no draft falls before the day after
 * tomorrow, and the reminder hours only when one does.
 */
export async function lockDueDrafts(db: D1Database, now: Date, readHours: () => Promise<ReminderHours>): Promise<void> {
  const after = indiaInstant(addDays(indiaDate(now), 2), "00:00").toISOString();
  const due = await db
    .prepare("SELECT 1 AS due FROM appointments WHERE technician_draft = 1 AND window_start < ?1 LIMIT 1")
    .bind(after)
    .first();
  if (due === null) return;
  await lockDrafts(db, now, await readHours()).run();
}
