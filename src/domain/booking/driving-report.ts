// The Driving report (docs/decisions/0294-learned-drive-times.md): over the weeks asked, each technician's and each
// city's drives between their jobs, by day or by week, the minutes booking plans for them at today's pace against the
// minutes they took, and every city's learned slots beside, each with its drives and whether it is in use. Only the
// drives learned from are counted, so an errand or a lunch does not stand as a slow drive.

import { addDays, indiaDate, weekdayOf } from "../../lib/india-time.ts";
import { atPace } from "../../policy/drive-estimate.ts";
import { isClean, paceOf, type DayKind, type Learned } from "../../policy/learned-drives.ts";
import type { OpsInputs } from "../platform/ops-settings.ts";
import { drivesDone, type CityDrive } from "./learn-drives.ts";

export type DrivingBy = "day" | "week";

/** The drives of one technician, or one city, on a day or in a week. */
export interface DrivingRow {
  /** The day, or the Monday its week starts on. */
  readonly period: string;
  readonly drives: number;
  readonly planned_minutes: number;
  readonly actual_minutes: number;
}

export interface DrivingReport {
  readonly from: string;
  readonly to: string;
  readonly by_technician: (DrivingRow & { technician_id: string; name: string; city: string })[];
  readonly by_city: (DrivingRow & { city: string })[];
  readonly factors: {
    readonly city: string;
    readonly day_kind: DayKind;
    readonly hour: number;
    readonly factor_pct: number;
    readonly drives: number;
    readonly in_use: boolean;
  }[];
  readonly learning: { readonly use: OpsInputs["driveTimes"]["use"]; readonly min_drives: number };
}

type ReportInputs = Pick<OpsInputs, "driveEstimate" | "bookingRules" | "driveTimes" | "driveLearning">;

interface FactorRow {
  readonly city: string;
  readonly day_kind: DayKind;
  readonly hour: number;
  readonly factor_pct: number;
  readonly drives: number;
}

/** The Monday a date's week starts on. */
const mondayOf = (date: string): string => addDays(date, -((weekdayOf(date) + 6) % 7));

/** The drives summed under each key, each with its planned minutes, newest period first. */
function summed<T extends { period: string }>(
  drives: readonly (CityDrive & { planned: number })[],
  keyOf: (drive: CityDrive & { planned: number }) => T,
): (T & Omit<DrivingRow, "period">)[] {
  const rows = new Map<string, T & { drives: number; planned_minutes: number; actual_minutes: number }>();
  for (const drive of drives) {
    const key = keyOf(drive);
    const id = JSON.stringify(key);
    const row = rows.get(id) ?? { ...key, drives: 0, planned_minutes: 0, actual_minutes: 0 };
    rows.set(id, {
      ...row,
      drives: row.drives + 1,
      planned_minutes: row.planned_minutes + drive.planned,
      actual_minutes: row.actual_minutes + drive.took,
    });
  }
  return [...rows.values()].sort((one, other) => other.period.localeCompare(one.period));
}

/** The report over the `weeks` before today, India's, by day or week; one city's alone where asked. */
export async function drivingReport(
  db: D1Database,
  given: { readonly now: Date; readonly weeks: number; readonly by: DrivingBy; readonly city?: string | undefined },
  inputs: ReportInputs,
): Promise<DrivingReport> {
  const to = indiaDate(given.now);
  const from = addDays(to, -7 * given.weeks);
  const booking = inputs.bookingRules;
  const [done, factors] = await Promise.all([
    drivesDone(db, { from, to, estimate: inputs.driveEstimate, booking }),
    db
      .prepare("SELECT city, day_kind, hour, factor_pct, drives FROM drive_factors ORDER BY city, day_kind, hour")
      .all<FactorRow>(),
  ]);
  const learning = { use: inputs.driveTimes.use, minDrives: inputs.driveLearning.min_drives };
  const slots = factors.results.filter((row) => given.city === undefined || row.city === given.city);
  const learnedOf = (city: string): Learned[] =>
    slots
      .filter((row) => row.city === city)
      .map((row) => ({ dayKind: row.day_kind, hour: row.hour, factorPct: row.factor_pct, drives: row.drives }));
  const counted = done
    .filter((drive) => (given.city === undefined || drive.city === given.city) && isClean(drive, booking.break))
    .map((drive) => {
      const pace = paceOf(learnedOf(drive.city), { dayKind: drive.dayKind, ...learning })?.[drive.hour] ?? 100;
      return { ...drive, planned: atPace(drive.estimate, pace, inputs.driveEstimate) };
    });
  const periodOf = (date: string) => (given.by === "day" ? date : mondayOf(date));
  return {
    from,
    to: addDays(to, -1),
    by_technician: summed(counted, (drive) => ({
      period: periodOf(drive.date),
      technician_id: drive.technicianId,
      name: drive.name,
      city: drive.city,
    })),
    by_city: summed(counted, (drive) => ({ period: periodOf(drive.date), city: drive.city })),
    factors: slots.map((row) => ({
      ...row,
      in_use: learning.use === "learned" && row.drives >= learning.minDrives,
    })),
    learning: { use: learning.use, min_drives: learning.minDrives },
  };
}
