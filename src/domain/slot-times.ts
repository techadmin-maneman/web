// The times of each day's half-slots, as ops set them in the console (docs/decisions/0102-window-times.md;
// src/policy/slot-times.ts). The table holds a change or two a year, so it is read whole wherever a day's times are
// needed, and each day takes the change in force on it.

import type { BookingWindow } from "../config/scheduling.ts";
import { indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import {
  DEFAULT_SLOT_TIMES,
  earliestAppliesFrom,
  slotTimesProblems,
  windowAt,
  type SlotTimes,
} from "../policy/slot-times.ts";
import { auditStatementIfWritten, type AuditEntry } from "./audit.ts";

/** A change of times, from the day it applies. */
export interface SlotTimesChange extends SlotTimes {
  readonly appliesFrom: string;
  readonly setBy: string;
  readonly setAt: string;
}

/** The times in force on each day, and where an instant falls by them. */
export interface SlotSchedule {
  /** Every change ops made, the earliest first. */
  readonly changes: readonly SlotTimesChange[];
  on(date: string): SlotTimes;
  /** The day in India an instant falls on, its time of day there, and its window by that day's times. */
  at(instant: Date | string): { readonly date: string; readonly time: string; readonly window: BookingWindow };
}

/** The schedule these changes make; with none, every day keeps the times in code. */
function scheduleOf(changes: readonly SlotTimesChange[]): SlotSchedule {
  const earliestFirst = [...changes].sort((a, b) => a.appliesFrom.localeCompare(b.appliesFrom));
  const on = (date: string): SlotTimes =>
    earliestFirst.findLast((change) => change.appliesFrom <= date) ?? DEFAULT_SLOT_TIMES;
  return {
    changes: earliestFirst,
    on,
    at(instant) {
      const when = typeof instant === "string" ? new Date(instant) : instant;
      const date = indiaDate(when);
      const time = indiaTime(when);
      return { date, time, window: windowAt(time, on(date)) };
    },
  };
}

interface ChangeRow {
  applies_from: string;
  unit_starts: string;
  day_end: string;
  set_by: string;
  set_at: string;
}

export async function loadSlotSchedule(db: D1Database): Promise<SlotSchedule> {
  const { results } = await db
    .prepare("SELECT applies_from, unit_starts, day_end, set_by, set_at FROM slot_times ORDER BY applies_from")
    .all<ChangeRow>();
  return scheduleOf(
    results.map((row) => ({
      appliesFrom: row.applies_from,
      unitStarts: JSON.parse(row.unit_starts) as string[],
      dayEnd: row.day_end,
      setBy: row.set_by,
      setAt: row.set_at,
    })),
  );
}

/** The last day any client's visit is booked, or held for payment or to be booked, on; null where there is none. */
async function lastBookedDate(db: D1Database): Promise<string | null> {
  const [visit, hold] = await db.batch<{ last: string | null }>([
    db.prepare(
      `SELECT MAX(window_start) AS last FROM appointments
       WHERE deleted_at IS NULL AND status IN ('scheduled', 'dispatched', 'in_progress')`,
    ),
    db.prepare("SELECT MAX(date) AS last FROM slot_holds WHERE state = 'held'"),
  ]);
  const visitLast = visit?.results[0]?.last ?? null;
  const dates = [visitLast === null ? null : indiaDate(new Date(visitLast)), hold?.results[0]?.last ?? null];
  return dates.reduce<string | null>(
    (latest, date) => (date !== null && (latest === null || date > latest) ? date : latest),
    null,
  );
}

/** The earliest day a change of times may apply from now (earliestAppliesFrom, src/policy/slot-times.ts). */
export async function earliestChange(db: D1Database, now: Date, horizonDays: number): Promise<string> {
  const schedule = await loadSlotSchedule(db);
  const lastChange = schedule.changes.at(-1)?.appliesFrom ?? null;
  return earliestAppliesFrom(indiaDate(now), horizonDays, await lastBookedDate(db), lastChange);
}

type SlotTimesSet =
  | { readonly kind: "set"; readonly appliesFrom: string }
  | { readonly kind: "invalid"; readonly problems: readonly string[] }
  /** Before the earliest day a change may apply from, which is said; or a visit was booked there meanwhile. */
  | { readonly kind: "too_soon"; readonly earliest: string };

/**
 * Adds a change of times from a day, audited in the same batch. It is written only if, as it is written, no change
 * applies from that day or later and no visit is booked or held on that day or later; so two members of staff saving
 * at once, or a visit booked meanwhile, cannot leave a booked visit under times it was not booked by.
 */
export async function setSlotTimes(
  db: D1Database,
  input: {
    readonly times: SlotTimes;
    readonly appliesFrom: string;
    readonly staff: string;
    readonly now: Date;
    readonly horizonDays: number;
    readonly audit: AuditEntry;
  },
): Promise<SlotTimesSet> {
  const problems = slotTimesProblems(input.times);
  if (problems.length > 0) return { kind: "invalid", problems };

  const earliest = await earliestChange(db, input.now, input.horizonDays);
  if (input.appliesFrom < earliest) return { kind: "too_soon", earliest };

  const id = crypto.randomUUID();
  const at = input.now.toISOString();
  const fromInstant = indiaInstant(input.appliesFrom, "00:00").toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO slot_times (id, applies_from, unit_starts, day_end, set_by, set_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         WHERE NOT EXISTS (SELECT 1 FROM slot_times WHERE applies_from >= ?2)
           AND NOT EXISTS (SELECT 1 FROM slot_holds WHERE state = 'held' AND date >= ?2)
           AND NOT EXISTS (
             SELECT 1 FROM appointments WHERE deleted_at IS NULL
               AND status IN ('scheduled', 'dispatched', 'in_progress') AND window_start >= ?7)`,
      )
      .bind(
        id,
        input.appliesFrom,
        JSON.stringify(input.times.unitStarts),
        input.times.dayEnd,
        input.staff,
        at,
        fromInstant,
      ),
    auditStatementIfWritten(db, input.audit, input.now, { table: "slot_times", id }),
  ]);
  const written = await db.prepare("SELECT 1 FROM slot_times WHERE id = ?1").bind(id).first();
  if (written === null) return { kind: "too_soon", earliest: await earliestChange(db, input.now, input.horizonDays) };
  return { kind: "set", appliesFrom: input.appliesFrom };
}
