// Home's prompts, in the owner's order (src/policy/home-prompt.ts):
//
//   1. no address given, while something is booked;
//   2. the next service due and not booked (src/domain/next-visit.ts), with its day and window, or the replacement
//      instead where the piece falls due first. A service offers the replacement beside it once the piece's month
//      is within how far ahead a visit may be booked;
//   3. an invoice issued in the last fortnight, ready to open, as a line of its own beneath the prompt;
//   4. the piece in wear falling due, as a month and never a day, once that month is within how far ahead a visit
//      may be booked, and while no replacement is booked or paid for.
//
// One statement answers them all, so Home, the route the app calls every time it opens, costs one more D1 read.

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
      readonly tier: string | null;
      /** India's day it is offered on: the day it falls due, or tomorrow once that has passed. */
      readonly date: string;
      readonly window: BookingWindow | null;
      /** A service offered while the replacement may be booked too, so Home offers it beside the service. */
      readonly replacement_bookable: boolean;
    }
  | {
      readonly kind: "replacement_due";
      readonly month: string;
      /** The replacement service offered: the client's last one while offered, else the first (serviceToOffer). */
      readonly tier: string | null;
    };

/** An invoice issued in the last `invoice_prompt` days, which Home offers to open. */
export interface InvoiceReady {
  readonly visit_id: string;
  /** India's date of the visit. */
  readonly date: string;
  readonly type: VisitType | null;
}

export interface HomePrompts {
  readonly prompt: HomePrompt | null;
  /** The line beneath the prompt, or the only line where none applies. */
  readonly invoice: InvoiceReady | null;
}

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

interface Row {
  has_address: number;
  due_on: string | null;
  replacement_booked: number;
  invoiced_id: string | null;
  invoiced_type: VisitType | null;
  invoiced_start: string | null;
}

/** What the client has now: whether anything is booked, and what the app offers them next. */
export interface ClientStanding {
  readonly booked: boolean;
  readonly offer: NextOffer | null;
}

type NextService = NextOffer & { readonly type: "service" | "replacement" };

/** The next service, or the replacement in its place, which the prompt offers; a first fit is Home's card, not a prompt. */
const nextServiceOf = (offer: NextOffer | null): NextService | null =>
  offer !== null && offer.type !== "first_fit" ? { ...offer, type: offer.type } : null;

/** The month the piece in wear falls due, while no replacement is booked and that month may be booked now. */
function replacementMonthInReach(row: Row, tomorrow: string, days: NextVisitDays): string | null {
  if (row.due_on === null || row.replacement_booked === 1) return null;
  const month = row.due_on.slice(0, 7);
  return `${month}-01` <= lastBookableDay(tomorrow, days) ? month : null;
}

function invoiceOf(row: Row): InvoiceReady | null {
  if (row.invoiced_id === null || row.invoiced_start === null) return null;
  return {
    visit_id: row.invoiced_id,
    date: indiaDate(new Date(row.invoiced_start)),
    type: row.invoiced_type,
  };
}

async function replacementPrompt(
  db: D1Database,
  personId: string,
  month: string,
  tomorrow: string,
): Promise<HomePrompt> {
  // Offered from the month it falls due, or from tomorrow once that month has begun.
  const firstDay = `${month}-01`;
  const from = firstDay > tomorrow ? firstDay : tomorrow;
  const tier = await serviceToOffer(db, personId, "replacement", from);
  return { kind: "replacement_due", month, tier };
}

function nextVisitPrompt(next: NextService, replacementMonth: string | null): HomePrompt {
  return {
    kind: "next_visit",
    type: next.type,
    tier: next.tier,
    date: next.date,
    window: next.window,
    replacement_bookable: next.type === "service" && replacementMonth !== null,
  };
}

/** The prompt Home shows this client, and the invoice line beneath it. */
export async function homePrompts(
  db: D1Database,
  personId: string,
  standing: ClientStanding,
  now: Date,
  days: NextVisitDays,
): Promise<HomePrompts> {
  const since = new Date(now.getTime() - days.invoice_prompt * DAY_MS).toISOString();
  const row = await db.prepare(PROMPT).bind(personId, since).first<Row>();
  if (row === null) return { prompt: null, invoice: null };
  const tomorrow = addDays(indiaDate(now), 1);
  const next = nextServiceOf(standing.offer);
  const replacementMonth = replacementMonthInReach(row, tomorrow, days);
  const invoice = invoiceOf(row);
  const lead = homePromptOf({
    address: row.has_address === 0 && standing.booked,
    next_visit: next !== null,
    invoice_ready: invoice !== null,
    replacement_due: replacementMonth !== null,
  });
  if (lead === "address") return { prompt: { kind: lead }, invoice };
  if (lead === "next_visit" && next !== null) return { prompt: nextVisitPrompt(next, replacementMonth), invoice };
  if (lead === "replacement_due" && replacementMonth !== null) {
    return { prompt: await replacementPrompt(db, personId, replacementMonth, tomorrow), invoice };
  }
  // The invoice leads, as the only line, or nothing applies.
  return { prompt: null, invoice };
}
