// When a held or booked visit starts and ends, from the half-slot it starts in and how long it takes.

import { VISIT_BLOCKS } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { indiaInstant } from "../lib/india-time.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { MINUTE_MS } from "../lib/durations.ts";

/**
 * When a visit starting in a half-slot starts and ends: from the half-slot's start by the times in
 * force on its day, for its length.
 */
export function visitTimes(
  date: string,
  startUnit: number,
  minutes: number,
  schedule: SlotSchedule,
): { start: Date; end: Date } {
  const { unitStarts } = schedule.on(date);
  const start = indiaInstant(date, unitStarts[startUnit] ?? unitStarts[0] ?? "09:00");
  return { start, end: new Date(start.getTime() + minutes * MINUTE_MS) };
}

/** How long a hold's visit is booked for: the length it was held for, or its kind's for a hold made before lengths. */
export const heldMinutes = (hold: { readonly type: VisitType; readonly minutes: number | null }): number =>
  hold.minutes ?? VISIT_BLOCKS[hold.type].minutes;

/** When a hold's visit starts and ends, from its half-slot by the times in force on its day. */
export async function heldVisitTimes(
  db: D1Database,
  hold: {
    readonly date: string;
    readonly start_unit: number;
    readonly type: VisitType;
    readonly minutes: number | null;
  },
): Promise<{ start: Date; end: Date }> {
  return visitTimes(hold.date, hold.start_unit, heldMinutes(hold), await loadSlotSchedule(db));
}
