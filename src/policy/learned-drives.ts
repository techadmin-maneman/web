// Drive times learned from our own drives (docs/decisions/0294-learned-drive-times.md): a drive is the time from one
// job's close to the same technician's next check-in that day, against what the estimate (./drive-estimate.ts) gave
// for it. A drive over three times its estimate, or one that spans the day's break and took the break's length more
// than its estimate, is left out, as an errand or a lunch. Each city's drives are grouped by weekday or weekend and the
// hour they set off in, and each group's middle drive, as a per cent of its estimate, is that hour's pace once enough
// drives stand behind it; until then the estimate stands. Ops set how many, how far back, and whether to use them.

import { weekdayOf } from "../lib/india-time.ts";

export const DRIVE_LEARNING_KEYS = ["min_drives", "weeks"] as const;
export type DriveLearning = Readonly<Record<(typeof DRIVE_LEARNING_KEYS)[number], number>>;

/** Twenty drives in an hour's group before it is trusted; the last eight weeks' drives learned from. */
export const DRIVE_LEARNING: DriveLearning = { min_drives: 20, weeks: 8 };

export const DRIVE_TIMES_KEYS = ["use"] as const;
export const DRIVE_TIMES_CHOICES = ["learned", "estimate"] as const;
export type DriveTimes = Readonly<Record<(typeof DRIVE_TIMES_KEYS)[number], (typeof DRIVE_TIMES_CHOICES)[number]>>;

/** Learned drive times used wherever an hour has enough drives behind it. */
export const DRIVE_TIMES: DriveTimes = { use: "learned" };

/** A drive's slot: a weekday or the weekend. */
export type DayKind = "weekday" | "weekend";

/** Whether India's `date` is a weekday or the weekend. */
export const dayKindOf = (date: string): DayKind => ([0, 6].includes(weekdayOf(date)) ? "weekend" : "weekday");

/** A drive as observed: when it set off, India's day kind and hour, what the estimate gave, and what it took. */
export interface Observed {
  readonly dayKind: DayKind;
  readonly hour: number;
  readonly estimate: number;
  readonly took: number;
  /** Whether the drive spans the day's break window. */
  readonly overBreak: boolean;
}

/** Whether a drive is one to learn from: not over three times its estimate, nor spanning the break and taking it. */
export function isClean(drive: Observed, breakMinutes: number): boolean {
  if (drive.took <= 0 || drive.estimate <= 0 || drive.took > 3 * drive.estimate) return false;
  return !(drive.overBreak && drive.took >= drive.estimate + breakMinutes);
}

/** The middle of the figures, the mean of the middle two where they are even; none for none. */
function median(figures: readonly number[]): number | null {
  if (figures.length === 0) return null;
  const sorted = [...figures].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** One hour's group of a city's drives: its slot, the middle drive as a per cent of its estimate, and how many. */
export interface Learned {
  readonly dayKind: DayKind;
  readonly hour: number;
  readonly factorPct: number;
  readonly drives: number;
}

/** Each slot's pace from a city's clean drives, the middle one's per cent of its estimate, rounded to a whole. */
export function learn(drives: readonly Observed[], breakMinutes: number): Learned[] {
  const slots = new Map<string, number[]>();
  for (const drive of drives.filter((each) => isClean(each, breakMinutes))) {
    const key = `${drive.dayKind}/${String(drive.hour)}`;
    slots.set(key, [...(slots.get(key) ?? []), (drive.took / drive.estimate) * 100]);
  }
  return [...slots].map(([key, ratios]) => {
    const [dayKind, hour] = key.split("/") as [DayKind, string];
    return { dayKind, hour: Number(hour), factorPct: Math.round(median(ratios) ?? 100), drives: ratios.length };
  });
}

/**
 * A day's pace, hour by hour: the learned per cent where the hour's group of that day kind has `minDrives` or more,
 * else 100, the estimate itself; null where none has, or ops use the estimate only.
 */
export function paceOf(
  learned: readonly Learned[],
  day: { readonly dayKind: DayKind; readonly minDrives: number; readonly use: DriveTimes["use"] },
): number[] | null {
  if (day.use === "estimate") return null;
  const trusted = learned.filter((slot) => slot.dayKind === day.dayKind && slot.drives >= day.minDrives);
  if (trusted.length === 0) return null;
  return Array.from({ length: 24 }, (_, hour) => trusted.find((slot) => slot.hour === hour)?.factorPct ?? 100);
}
