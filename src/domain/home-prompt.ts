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
import { addDays, indiaDate, monthOf } from "../lib/india-time.ts";
import { homePromptOf } from "../policy/home-prompt.ts";
import { lastBookableDay, type NextVisitDays } from "../policy/next-visit.ts";
import type { NextOffer } from "./next-visit.ts";
import { serviceToOffer } from "./services.ts";
import { DAY_MS } from "../lib/durations.ts";
import { paidNotBooked } from "./hold-stages.ts";
import { statusIn, VISIT_LIVE } from "../config/statuses.ts";

type HomePrompt =
  | { readonly kind: "address" }
  | {
      readonly kind: "next_visit";
      readonly type: "service" | "replacement";
      /** The service of its kind it offers (NextOffer.tier). */
      readonly tier: string | null;
      /** India's day it fell or falls due (NextOffer.due_on). */
      readonly due_on: string;
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
interface InvoiceReady {
  readonly visit_id: string;
  /** India's date of the visit. */
  readonly date: string;
  readonly type: VisitType | null;
}

interface HomePrompts {
  readonly prompt: HomePrompt | null;
  /** The line beneath the prompt, or the only line where none applies. */
  readonly invoice: InvoiceReady | null;
}

const PROMPT = `SELECT
  EXISTS (SELECT 1 FROM addresses WHERE person_id = ?1 AND replaced_at IS NULL) AS has_address,
  (SELECT MIN(replacement_due_at) FROM pieces
     WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL AND replacement_due_at IS NOT NULL) AS due_on,
  (EXISTS (SELECT 1 FROM appointments r WHERE r.person_id = ?1 AND r.deleted_at IS NULL AND r.type = 'replacement'
      AND ${statusIn("r.status", VISIT_LIVE)})
    OR EXISTS (SELECT 1 FROM slot_holds h WHERE h.person_id = ?1 AND h.type = 'replacement' AND ${paidNotBooked("h")}))
    AS replacement_booked,
  invoiced.id AS invoiced_id, invoiced.type AS invoiced_type, invoiced.window_start AS invoiced_start
  FROM (SELECT 1) LEFT JOIN (
    SELECT id, type, window_start FROM appointments
    WHERE person_id = ?1 AND deleted_at IS NULL AND window_start IS NOT NULL AND invoice_issued_at >= ?2
    ORDER BY invoice_issued_at DESC LIMIT 1
  ) invoiced ON TRUE`;

/** What the prompt turns on beyond the client's standing. */
interface PromptFacts {
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
interface ClientStanding {
  readonly booked: boolean;
  readonly offer: NextOffer | null;
}

type NextService = NextOffer & { readonly type: "service" | "replacement" };

/** The next service, or the replacement in its place, which the prompt offers; a first fit is Home's card, not a prompt. */
const nextServiceOf = (offer: NextOffer | null): NextService | null =>
  offer !== null && offer.type !== "first_fit" ? { ...offer, type: offer.type } : null;

/** The month the piece in wear falls due, while no replacement is booked and that month may be booked now. */
function replacementMonthInReach(row: PromptFacts, tomorrow: string, days: NextVisitDays): string | null {
  if (row.due_on === null || row.replacement_booked === 1) return null;
  const month = monthOf(row.due_on);
  return `${month}-01` <= lastBookableDay(tomorrow, days) ? month : null;
}

function invoiceOf(row: PromptFacts): InvoiceReady | null {
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
    due_on: next.due_on,
    date: next.date,
    window: next.window,
    replacement_bookable: next.type === "service" && replacementMonth !== null,
  };
}

/** The prompt Home shows this client, and the invoice line beneath it. */
export async function homePrompts(
  db: D1Database,
  personId: string,
  row: PromptFacts | null,
  standing: ClientStanding,
  now: Date,
  days: NextVisitDays,
): Promise<HomePrompts> {
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
