// Reports › Driving (docs/decisions/0294-learned-drive-times.md): the words of the page.

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
  /** "42 min" */
  minutes: (value: number) => `${String(value)} min`,
  /** "+12 min", "−5 min", "0 min" */
  gapMinutes: (value: number) => `${value > 0 ? "+" : ""}${value < 0 ? "−" : ""}${String(Math.abs(value))} min`,
  /** "Week of Mon 14 Sep" */
  weekOf: (monday: string) => `Week of ${monday}`,
  byCity: "By city",
  byTechnician: "By technician",
  columns: { city: "City", technician: "Technician", day: "Day", week: "Week" },
  noDrives: "No drives between jobs in these days.",
  learned: "Learned drive times",
  learnedColumns: { city: "City", days: "Days", hour: "Sets off", pace: "Pace", drives: "Drives", used: "In use" },
  dayKinds: { weekday: "Weekdays", weekend: "Weekends" },
  /** "140%" of the estimate. */
  pace: (pct: number) => `${String(pct)}%`,
  used: "Yes",
  notYet: "Not yet",
  /** Ops use the estimate only (Settings › Booking, Drive times). */
  estimateOnly: "Drive times use the estimate only.",
  /** "In use once a slot has 20 drives." */
  minimum: (drives: number) => `In use once a slot has ${String(drives)} drives.`,
  noLearned: "Nothing learned yet.",
} as const;
