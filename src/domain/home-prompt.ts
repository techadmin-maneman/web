// Home's one contextual prompt (design/phase2/Client App, board B1: "One card,
// one prompt, nothing else"). The first of these that applies, and only one, in
// the owner's order (src/policy/home-prompt.ts):
//
//   1. no address given, while something is booked: the technician cannot find
//      the door without one;
//   2. the next service due and not booked: the next visit the app offers
//      (src/domain/next-visit.ts), with its day and window, which the booking
//      sheet opens pre-filled with, or the replacement instead where the piece
//      falls due first;
//   3. the piece in wear falling due, as a month and never a day (ADR 0059),
//      which is booked in the app like any other visit, while no replacement is
//      booked or paid for: one already on its way is Home's card, and offering
//      another would sell the client a second;
//   4. an invoice issued in the last fortnight, ready to open.
//
// One statement answers the rest, so Home, the route the app calls every time it
// opens, costs one more D1 read and not three. How long an invoice is shown, and
// how far ahead a replacement may be booked, are ops' to set (`booking_days`).

import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate } from "../lib/india-time.ts";
import { homePromptOf } from "../policy/home-prompt.ts";
import { lastBookableDay, type NextVisitDays } from "../policy/next-visit.ts";
import type { NextOffer } from "./next-visit.ts";
import { serviceToOffer } from "./services.ts";
import { DAY_MS } from "../lib/durations.ts";

export type HomePrompt =
  | { readonly kind: "address" }
  | {
      readonly kind: "next_visit";
      readonly type: "service" | "replacement";
      /** The service of its kind it offers (NextOffer.tier). */
      readonly tier: string;
      /** India's day it is offered on: the day it falls due, or tomorrow once that has passed. */
      readonly date: string;
      readonly window: BookingWindow | null;
    }
  | {
      readonly kind: "replacement_due";
      readonly month: string;
      /** The replacement service offered: the client's last one while offered, else the first (serviceToOffer). */
      readonly tier: string;
      /** The month begins within how far ahead a visit may be booked, so the replacement can be booked now. */
      readonly bookable: boolean;
    }
  | {
      readonly kind: "invoice_ready";
      readonly visit_id: string;
      /** India's date of the visit. */
      readonly date: string;
      readonly type: VisitType | null;
    };

const PROMPT = `SELECT
  EXISTS (SELECT 1 FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL) AS has_address,
  (SELECT MIN(replacement_due_at) FROM pieces
     WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL) AS due_on,
  (EXISTS (SELECT 1 FROM appointments r WHERE r.person_id = ?1 AND r.deleted_at IS NULL AND r.type = 'replacement'
      AND r.status IN ('scheduled', 'dispatched', 'in_progress'))
    OR EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = ?1 AND h.type = 'replacement' AND h.state = 'held'
      AND h.confirmed_at IS NOT NULL)) AS replacement_booked,
  invoiced.id AS invoiced_id, invoiced.type AS invoiced_type, invoiced.window_start AS invoiced_start
  FROM (SELECT 1) LEFT JOIN (
    SELECT id, type, window_start FROM appointments
    WHERE person_id = ?1 AND deleted_at IS NULL AND window_start IS NOT NULL AND invoice_issued_at >= ?2
    ORDER BY invoice_issued_at DESC LIMIT 1
  ) invoiced ON TRUE`;

/** What the prompt turns on beyond the client's standing. */
export interface PromptFacts {
  readonly has_address: number;
  readonly due_on: string | null;
  readonly replacement_booked: number;
  readonly invoiced_id: string | null;
  readonly invoiced_type: VisitType | null;
  readonly invoiced_start: string | null;
}

/** Read apart from the decision, so Home can send this read with its others. */
export function promptFacts(
  db: D1Database,
  personId: string,
  now: Date,
  days: NextVisitDays,
): Promise<PromptFacts | null> {
  const since = new Date(now.getTime() - days.invoice_prompt * DAY_MS).toISOString();
  return db.prepare(PROMPT).bind(personId, since).first<PromptFacts>();
}

/** What the client has now: whether anything is booked, and what the app offers them next. */
export interface ClientStanding {
  readonly booked: boolean;
  readonly offer: NextOffer | null;
}

/** The next service, or the replacement in its place, which prompt 2 offers; a first fit is Home's card, not a prompt. */
const nextServiceOf = (offer: NextOffer | null): (NextOffer & { type: "service" | "replacement" }) | null =>
  offer !== null && offer.type !== "first_fit" ? { ...offer, type: offer.type } : null;

/** The prompt Home shows this client, or null when nothing applies. */
export async function homePrompt(
  db: D1Database,
  personId: string,
  row: PromptFacts | null,
  standing: ClientStanding,
  now: Date,
  days: NextVisitDays,
): Promise<HomePrompt | null> {
  if (row === null) return null;
  const next = nextServiceOf(standing.offer);
  const kind = homePromptOf({
    address: row.has_address === 0 && standing.booked,
    next_visit: next !== null,
    replacement_due: row.due_on !== null && row.replacement_booked === 0,
    invoice_ready: row.invoiced_id !== null && row.invoiced_start !== null,
  });
  switch (kind) {
    case "address":
      return { kind };
    case "next_visit":
      return next === null ? null : { kind, type: next.type, tier: next.tier, date: next.date, window: next.window };
    case "replacement_due": {
      const month = (row.due_on ?? "").slice(0, 7);
      const tomorrow = addDays(indiaDate(now), 1);
      // Offered from the month it falls due, or from tomorrow once that month has begun.
      const from = `${month}-01` > tomorrow ? `${month}-01` : tomorrow;
      const tier = await serviceToOffer(db, personId, "replacement", from);
      return { kind, month, tier, bookable: `${month}-01` <= lastBookableDay(tomorrow, days) };
    }
    case "invoice_ready":
      return row.invoiced_id === null || row.invoiced_start === null
        ? null
        : {
            kind,
            visit_id: row.invoiced_id,
            date: indiaDate(new Date(row.invoiced_start)),
            type: row.invoiced_type,
          };
    case null:
      return null;
  }
}
