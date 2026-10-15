// Operations · Usage (docs/decisions/0186-usage-and-shrinkage.md). No design draws it; every word here is ours. Only
// the Usage page reads it, loaded when it opens.

import { fullDate } from "@maneman/web-kit/dates";

export const usage = {
  title: "Usage",
  /** "Since 24 Aug 2026", of the day as YYYY-MM-DD. */
  since: (day: string) => `Since ${fullDate(day)}`,
  technicians: "Against expected",
  noTechnicians: "No visits done in these weeks.",
  technicianColumns: ["Technician", "Visits", "Expected", "Used", "Over by", ""],
  items: (name: string) => `Items of ${name}`,
  itemsShort: "Items",
  itemColumns: ["Item", "Expected", "Used", "Over by"],
  places: "Losses",
  noPlaces: "Nothing left any place in these weeks.",
  placeColumns: ["Place", "Left", "Lost", "Shrinkage", "Write-offs", "Counts right first time"],
  flagged: "Flagged",
  /** "+30%", "−20%", or a dash */
  over: (percent: number | null) => {
    if (percent === null) return "—";
    return percent < 0 ? `−${String(-percent)}%` : `+${String(percent)}%`;
  },
  percent: (percent: number | null) => (percent === null ? "—" : `${String(percent)}%`),
};
