// A visit as the screens write it: its kind, its technician's first name, and how long it took.

import type { VisitSummary } from "../api.ts";
import { OTHER_VISIT, VISIT_TYPES } from "../content.ts";

export const visitName = (type: VisitSummary["type"]) => (type === null ? OTHER_VISIT : VISIT_TYPES[type]);

/** "Imran Qureshi" → "Imran": the name Home and the lists use; the visit's detail gives it in full. */
export const firstName = (name: string) => name.split(" ")[0] ?? name;

/** The technician's first name, as none or one, to join into a line: "Service visit · Imran". */
export const technicianOf = (visit: VisitSummary): string[] =>
  visit.technician === null ? [] : [firstName(visit.technician.name)];

/** 85 → "1 h 25 m", as board C9 writes a duration. */
export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} m`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} m`;
}
