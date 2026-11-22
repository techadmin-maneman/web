// Reports › Driving (docs/decisions/0294-learned-drive-times.md): the words of the page.

import { quantity } from "@maneman/web-kit/figures";
import { hoursAndMinutes } from "./common.ts";

/** "+", "−" or nothing, before a gap of minutes. */
const signOf = (minutes: number): string => `${minutes > 0 ? "+" : ""}${minutes < 0 ? "−" : ""}`;

/** A tile's total, from 100 hours in whole hours, "1,251 h", as minutes beside them would not fit; else as the console. */
const total = (minutes: number): string =>
  minutes >= 100 * 60 ? `${quantity(Math.round(minutes / 60))} h` : hoursAndMinutes(minutes);

export const driving = {
  period: "Over",
  periods: { "1": "The last week", "4": "The last 4 weeks", "8": "The last 8 weeks" },
  by: "Show",
  bys: { day: "By day", week: "By week" },
  /** "Mon 24 Aug to Sun 20 Sep" */
  span: (from: string, to: string) => `${from} to ${to}`,
  drives: "Drives",
  planned: "Planned",
  actual: "Taken",
  gap: "Gap",
  total,
  /** "+12 min", "−1 h 5 min", "0 min" */
  signed: (minutes: number) => `${signOf(minutes)}${hoursAndMinutes(Math.abs(minutes))}`,
  /** A tile's gap: "+27 min", "−112 h". */
  signedTotal: (minutes: number) => `${signOf(minutes)}${total(Math.abs(minutes))}`,
  byCity: "By city",
  byTechnician: "By technician",
  columns: { city: "City", technician: "Technician", day: "Day", week: "Week of" },
  narrow: { cities: "Filter cities", technicians: "Filter technicians", learned: "Filter drive times" },
  noDrives: "No drives between jobs in these days.",
  learned: "Learned drive times",
  learnedColumns: {
    city: "City",
    days: "Days",
    hour: "Hour",
    pace: "Of estimate",
    drives: "Drives",
    enough: "Enough drives",
  },
  dayKinds: { weekday: "Weekdays", weekend: "Weekends" },
  /** "140%" of the estimate. */
  pace: (pct: number) => `${String(pct)}%`,
  yes: "Yes",
  notYet: "Not yet",
  /** "An hour is used once it has 20 drives." */
  used: (drives: number) => `An hour is used once it has ${String(drives)} drives.`,
  /** Ops use the estimate only (Settings › Booking, Drive times). */
  estimateOnly: (drives: number) =>
    `Drive times use the estimate only. An hour would be used once it has ${String(drives)} drives.`,
  noLearned: "Nothing learned yet.",
} as const;
