// Reports › Driving (docs/decisions/0294-learned-drive-times.md): the words of the page.

import { quantity } from "@maneman/web-kit/figures";

/** "1,250 h 30 min", "45 min", "3 h": a length of time as the console writes one, its hours grouped. */
function duration(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${String(minutes)} min`;
  return minutes === 0 ? `${quantity(hours)} h` : `${quantity(hours)} h ${String(minutes)} min`;
}

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
  duration,
  /** "+12 min", "−1 h 5 min", "0 min" */
  signed: (minutes: number) => `${minutes > 0 ? "+" : ""}${minutes < 0 ? "−" : ""}${duration(Math.abs(minutes))}`,
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
