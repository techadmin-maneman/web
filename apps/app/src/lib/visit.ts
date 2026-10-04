// A visit as the screens write it: its kind, its technician's first name, and how long it took.

import type { Me, VisitDetail, VisitSummary } from "../api.ts";
import { ONE_VISIT, OTHER_VISIT, VISIT_TYPES } from "../content.ts";

export const visitName = (type: VisitSummary["type"]) => (type === null ? OTHER_VISIT : VISIT_TYPES[type]);

/** The visit's kind, and its service where that says more: "First fit · Mane Man Essential". */
export function visitTitle(visit: Pick<VisitSummary, "type" | "service">): string {
  // A visit the phone kept from an earlier release names no service.
  const service = visit.service ?? null;
  return service === null ? visitName(visit.type) : `${visitName(visit.type)} · ${service}`;
}

/** A visit being booked, by its kind; a consultation and fit in one visit by that name. */
export const bookingName = (booking: NonNullable<Me["being_booked"]>) =>
  booking.one_visit ? ONE_VISIT : VISIT_TYPES[booking.type];

/** "Imran Qureshi" → "Imran": the name Home and the lists use; the visit's detail gives it in full. */
export const firstName = (name: string) => name.split(" ")[0] ?? name;

/** The technician's first name, as none or one, to join into a line: "Service visit · Imran". */
export const technicianOf = (visit: VisitSummary): string[] =>
  visit.technician === null ? [] : [firstName(visit.technician.name)];

/** A day after the visit, "usually ready within the hour" is no longer true of its invoice. */
const INVOICE_LATE_MS = 24 * 60 * 60 * 1000;

export type InvoiceState = "open" | "free" | "credit" | "checking" | "generating" | "late" | "none";

/**
 * What a finished visit can say of its invoice (ADR 0056): here to open, never coming because the visit was free,
 * held back (ADR 0070) because a credit paid for the visit or because it is being checked, still generating, or
 * late. Nothing at all for a visit not completed, which is billed by hand if at all.
 */
export function invoiceState(visit: VisitDetail, now: number): InvoiceState {
  if (visit.status !== "completed") return "none";
  if (visit.document_id !== null) return "open";
  if (!visit.invoice_expected) return "free";
  if (visit.invoice_held !== null) return visit.invoice_held;
  return now - Date.parse(visit.ends_at) > INVOICE_LATE_MS ? "late" : "generating";
}

/** 85 → "1 h 25 m", as board C9 writes a duration. */
export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} m`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} m`;
}
