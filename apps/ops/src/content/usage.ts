// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md). No design draws it; every word here is ours. Only
// the Usage page reads it, loaded when it opens.

import { plainDate } from "@maneman/web-kit/plain-date";

export const usage = {
  title: "Usage",
  /** "Since 24 Aug 2026", of the day as YYYY-MM-DD. */
  since: (day: string) => `Since ${plainDate(day)}`,
  technicians: "Against expected",
  /** Above the table: each technician's use over what their visits expected, the furthest over first. */
  chart: "Used over expected",
  noTechnicians: "No visits done in these weeks.",
  technicianColumns: ["Technician", "Visits", "Expected", "Used", "Over by"] as const,
  find: "Find a technician",
  items: (name: string) => `Items of ${name}`,
  itemColumns: ["Item", "Expected", "Used", "Over by"] as const,
  places: "Losses",
  noPlaces: "Nothing left any place in these weeks.",
  placeColumns: ["Place", "Left", "Lost", "Shrinkage", "Write-offs", "Counts right first time"] as const,
  findPlace: "Find a place",
  flagged: "Flagged",
  /** "+30%", "−20%", "0%" where it was just as expected, or a dash */
  over: (percent: number | null) => {
    if (percent === null) return "—";
    if (percent === 0) return "0%";
    return percent < 0 ? `−${String(-percent)}%` : `+${String(percent)}%`;
  },
  percent: (percent: number | null) => (percent === null ? "—" : `${String(percent)}%`),
};
