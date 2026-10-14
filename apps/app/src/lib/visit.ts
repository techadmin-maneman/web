// A visit as the screens write it: its kind, its technician's first name, and how long it took.

import type { Me, OneVisitPrice, VisitDetail, VisitSummary } from "../api.ts";
import { ONE_VISIT, OTHER_VISIT, VISIT_TYPES } from "../content.ts";
import { firstNameOf } from "@rules/lib/names.ts";

export const visitName = (type: VisitSummary["type"]) => (type === null ? OTHER_VISIT : VISIT_TYPES[type]);

/** A one visit's price; null for any other visit or booking. */
export const oneVisitOf = (visit: { readonly one_visit: OneVisitPrice | null }): OneVisitPrice | null =>
  visit.one_visit;

/** The visit's kind, and its service where that says more: "First fit · Mane Man Essential". */
export function visitTitle(visit: Pick<VisitSummary, "type" | "service">): string {
  return visit.service === null ? visitName(visit.type) : `${visitName(visit.type)} · ${visit.service}`;
}

/** A visit being booked, by its kind; a consultation and fit in one visit by that name. */
export const bookingName = (booking: NonNullable<Me["being_booked"]>) =>
  booking.one_visit ? ONE_VISIT : VISIT_TYPES[booking.type];

/** A visit by its kind; a consultation and fit in one visit, still to happen, by that name. */
export const summaryName = (visit: VisitSummary) => (oneVisitOf(visit) === null ? visitName(visit.type) : ONE_VISIT);

/** The technician's first name, as none or one, to join into a line: "Service visit · Imran". */
export const technicianOf = (visit: VisitSummary): string[] =>
  visit.technician === null ? [] : [firstNameOf(visit.technician.name)];

/** A day after the visit, "usually ready within the hour" is no longer true of its invoice. */
const INVOICE_LATE_MS = 24 * 60 * 60 * 1000;

/** How long after the visit an invoice is usually raised: past it, the client is offered a way to ask for it. */
const INVOICE_USUAL_MS = 60 * 60 * 1000;

type InvoiceState = "open" | "free" | "credit" | "checking" | "generating" | "delayed" | "late" | "none";

/**
 * What a finished visit can say of its invoice (ADR 0056): here to open, never coming because the visit was free,
 * held back (ADR 0070) because a credit paid for the visit or because it is being checked, still generating, past
 * the hour it usually takes, or late. Nothing at all for a visit not completed, which is billed by hand if at all.
 */
export function invoiceState(visit: VisitDetail, now: number): InvoiceState {
  if (visit.status !== "completed") return "none";
  if (visit.document_id !== null) return "open";
  if (!visit.invoice_expected) return "free";
  if (visit.invoice_held !== null) return visit.invoice_held;
  const since = now - Date.parse(visit.ends_at);
  if (since > INVOICE_LATE_MS) return "late";
  return since > INVOICE_USUAL_MS ? "delayed" : "generating";
}

