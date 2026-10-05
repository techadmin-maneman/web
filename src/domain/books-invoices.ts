// The invoice for a finished visit, raised in Books from our own figures.
//
// One line on the visit's Books item: the price book's GST-inclusive price on the day, less any discount code before
// tax, under the appointment's ID as its reference, by which a later pass finds it. Books works out the total. The
// invoice is sent, and the client may open it, only when it totals what the visit was sold for, and never for a visit a
// referral credit paid for; otherwise it stays a draft and ops are told. A draft under any other reference was made by
// hand, and is never sent from here. A consultation is free, and is not invoiced.
//
// Each visit is claimed before Books is asked, so overlapping runs never raise it twice. One that fails waits an hour;
// ops hear of a refusal at once and of any other failure on its third time.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { placeOfSupply, type GstRegistration } from "../config/gst.ts";
import { STANDARD_TIER, VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import { HOUR_MS } from "../lib/durations.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import { discounted } from "../policy/discount-codes.ts";
import { invoiceHold, type InvoiceHold, type SoldVisit } from "../policy/prepayment.ts";
import type { BooksInvoice, BooksProvider, NewBooksInvoice } from "../providers/books/index.ts";
import { isRefusal } from "../providers/provider-error.ts";
import { paymentsTab, type AlertOnce, type ResolveAlert } from "./alerts.ts";
import { customerFor } from "./books-customers.ts";
import { codeOnVisit, priceAfterCode } from "./discount-code-uses.ts";
import { priceOf, type Price } from "./price-book.ts";
import { PAYMENT_HELD, statusIn } from "../config/statuses.ts";
import { creditSpentOn } from "./visit-facts.ts";

/** How many a pass bills at most. */
const PER_PASS = 5;
export const RECHECK_AFTER_MS = HOUR_MS;
/**
 * Outside calls one visit may cost: the invoice kept on it, the look for one under our reference, the client's
 * customer, the invoice's making, its sending, and an alert.
 */
export const CALLS_PER_VISIT = 6;
/** The client is told their invoice comes within the hour of the visit. */
const DRAFT_ALERT_AFTER_MS = HOUR_MS;
/** A failure other than a refusal is told once it has happened this many times, an hour apart. */
const FAILURES_BEFORE_ALERT = 3;

/** How many invoices this pass raised, and how many became documents the client may see. */
type InvoiceSummary = { raised: number; issued: number };

interface BooksInvoiceDeps {
  readonly books: BooksProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
}

export interface BooksInvoiceOptions {
  readonly labelAsTest: boolean;
  readonly gst: GstRegistration;
}

/** A visit as its figures are worked out: what it was, of which service, and when. */
interface PricedVisit {
  readonly id: string;
  readonly type: VisitType | null;
  /** Its service's tier; null where none is known, which is the standard tier's. */
  readonly tier: string | null;
  readonly window_start: string | null;
}

interface Visit extends PricedVisit {
  readonly person_id: string;
  readonly type: VisitType;
  readonly window_start: string;
  readonly window_end: string | null;
  readonly service_city: string | null;
  /** Books' ID of the invoice kept on it, once one was raised or found. */
  readonly fsm_invoice_id: string | null;
}

interface Pass {
  readonly db: D1Database;
  readonly deps: BooksInvoiceDeps;
  readonly options: BooksInvoiceOptions;
  readonly now: Date;
  readonly recheck: string;
  readonly log: Logger;
}

type Done = { raised: boolean; issued: boolean };
const NOTHING: Done = { raised: false, issued: false };

/** A draft is not a valid tax invoice, and a voided one is no longer one; anything else has been issued. */
const isIssued = (status: string) => status !== "draft" && status !== "void";

export async function raiseBooksInvoices(
  db: D1Database,
  deps: BooksInvoiceDeps,
  options: BooksInvoiceOptions,
  now: Date,
  log: Logger,
  budget: CallBudget,
): Promise<InvoiceSummary> {
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const pass: Pass = { db, deps, options, now, recheck, log };
  const summary: InvoiceSummary = { raised: 0, issued: 0 };
  for (const visit of await visitsToInvoice(pass)) {
    if (!budget.spend(CALLS_PER_VISIT)) break;
    if (!(await claimVisit(pass, visit.id))) continue;
    try {
      const done = await invoiceVisit(pass, visit);
      if (done.raised) summary.raised += 1;
      if (done.issued) summary.issued += 1;
    } catch (error) {
      await tellFailure(pass, visit, error);
    }
  }
  return summary;
}

/** Finished visits that are sold, not yet invoiced, and not tried within the hour, of clients not erased. */
async function visitsToInvoice(pass: Pass): Promise<Visit[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.tier, a.window_start, a.window_end, a.service_city, a.fsm_invoice_id
       FROM appointments a
       WHERE a.status = 'completed' AND a.invoice_issued_at IS NULL AND a.deleted_at IS NULL
         AND a.type IN ('first_fit', 'service', 'replacement') AND a.one_visit IS NOT 'declined'
         AND a.person_id IS NOT NULL AND a.window_start IS NOT NULL
         AND (a.invoice_checked_at IS NULL OR a.invoice_checked_at < ?1)
         AND NOT EXISTS (SELECT 1 FROM people pe WHERE pe.id = a.person_id AND pe.erased_at IS NOT NULL)
       ORDER BY a.window_start LIMIT ?2`,
    )
    .bind(pass.recheck, PER_PASS)
    .all<Visit>();
  return results;
}

/** Takes the visit for this pass, marking it tried now; false where an overlapping run took it first. */
async function claimVisit(pass: Pass, appointmentId: string): Promise<boolean> {
  const claimed = await pass.db
    .prepare(
      `UPDATE appointments SET invoice_checked_at = ?1
       WHERE id = ?2 AND invoice_issued_at IS NULL AND (invoice_checked_at IS NULL OR invoice_checked_at < ?3)
       RETURNING id`,
    )
    .bind(pass.now.toISOString(), appointmentId, pass.recheck)
    .first();
  return claimed !== null;
}

/** One visit's invoice, raised if need be, and sent if it may be. A failure is thrown, for the pass to tell. */
async function invoiceVisit(pass: Pass, visit: Visit): Promise<Done> {
  const held = await invoiceHeld(pass, visit);
  if (held !== null) return settleHeld(pass, visit, held);
  const raised = await raiseInvoice(pass, visit);
  if (raised === null) return NOTHING;
  const issued = await sendIfSold(pass, visit, raised);
  return { raised: true, issued };
}

/**
 * The invoice Books already holds for the visit: the one kept on it, else one under our reference, which an earlier
 * pass raised and lost the answer to, kept now. Null where Books holds neither.
 */
async function invoiceHeld(pass: Pass, visit: Visit): Promise<BooksInvoice | null> {
  if (visit.fsm_invoice_id !== null) {
    const kept = await pass.deps.books.invoice(visit.fsm_invoice_id);
    if (kept !== null) return kept;
  }
  const ours = await pass.deps.books.findInvoice(visit.id);
  if (ours !== null) await keepInvoice(pass, visit.id, ours.id);
  return ours;
}

/** An invoice Books already held: the client's once issued; ours sent once it is right; any other left to ops. */
async function settleHeld(pass: Pass, visit: Visit, invoice: BooksInvoice): Promise<Done> {
  if (isIssued(invoice.status)) {
    await markIssued(pass, visit.id);
    return { raised: false, issued: true };
  }
  if (invoice.status === "void") {
    await tellVoid(pass, visit, invoice);
    return NOTHING;
  }
  if (invoice.reference !== visit.id) {
    if (endedOverAnHourAgo(pass, visit)) await tellHandMade(pass, visit, invoice);
    return NOTHING;
  }
  const issued = await sendIfSold(pass, visit, invoice);
  return { raised: false, issued };
}

/** Raises the visit's draft and keeps its ID; null where the visit cannot be invoiced yet, which is told or logged. */
async function raiseInvoice(pass: Pass, visit: Visit): Promise<BooksInvoice | null> {
  const { db, deps, options } = pass;
  const price = await listPrice(db, visit);
  if (price === null) {
    await tellUnpriced(pass, visit);
    return null;
  }
  const item = await itemOf(db, visit);
  if (item === null) {
    // The hourly item check tells ops of a service Books has no item for.
    pass.log.warn("invoice_item_missing", { appointment_id: visit.id, type: visit.type, tier: visit.tier });
    return null;
  }
  const customerId = await customerFor(db, deps.books, visit.person_id, options.gst);
  if (customerId === null) return null;

  const code = await codeOff(db, visit.id, price);
  const sold = discounted(price, code?.off ?? 0);
  const day = indiaDate(new Date(visit.window_start));
  const label = options.labelAsTest ? "Staging test: " : "";
  const invoice: NewBooksInvoice = {
    customerId,
    reference: visit.id,
    date: day,
    placeOfSupply: placeOfSupply(visit.service_city, options.gst),
    line: {
      itemId: item.itemId,
      name: item.name,
      description: `${label}${VISIT_TYPE_NAMES[visit.type]}, ${shortDate(day)}`,
      rate: price.amount,
      discount: price.amount - sold.amount,
    },
  };
  const raised = await deps.books.createInvoice(invoice);
  // Kept before it is sent: a later pass then reads this one rather than looking for it.
  await keepInvoice(pass, visit.id, raised.id);
  return raised;
}

/** Sends a draft of ours if it totals what the visit was sold for; otherwise holds it and tells ops. True if sent. */
async function sendIfSold(pass: Pass, visit: Visit, invoice: BooksInvoice): Promise<boolean> {
  const { db, deps } = pass;
  // Checked before it is sent: an issued invoice is undone only by a credit note.
  const code = await codeOff(db, visit.id, await listPrice(db, visit));
  const sold = await soldVisit(db, visit, code?.off ?? 0);
  const hold = invoiceHold(invoice.total, sold);
  if (hold !== null) {
    pass.log.warn("invoice_held", { appointment_id: visit.id, hold });
    await tellHeld(pass, visit, invoice, hold, sold);
    return false;
  }
  try {
    await deps.books.issueInvoice(invoice.id);
  } catch (error) {
    pass.log.warn("invoice_not_issued", { appointment_id: visit.id, error });
    await tellNotSent(pass, visit, invoice);
    return false;
  }
  await markIssued(pass, visit.id);
  return true;
}

/** The visit's service: its Books item and name. Null where the service has no item kept on it yet. */
async function itemOf(db: D1Database, visit: Visit): Promise<{ itemId: string; name: string } | null> {
  const service = await db
    .prepare("SELECT name, books_item_id FROM services WHERE kind = ?1 AND tier = ?2")
    .bind(visit.type, visit.tier ?? STANDARD_TIER)
    .first<{ name: string; books_item_id: string | null }>();
  if (service === null) return null;
  if (service.books_item_id === null) return null;
  return { itemId: service.books_item_id, name: service.name };
}

async function keepInvoice(pass: Pass, appointmentId: string, invoiceId: string): Promise<void> {
  await pass.db
    .prepare("UPDATE appointments SET fsm_invoice_id = ?1 WHERE id = ?2")
    .bind(invoiceId, appointmentId)
    .run();
}

// ---------------------------------------------------------------------------
// What the visit was sold for
// ---------------------------------------------------------------------------

/**
 * What the visit's discount code takes off before GST, fixed now where it was not yet; null for a visit with no code,
 * or one whose price the book does not have, which the check then holds.
 */
async function codeOff(
  db: D1Database,
  visitId: string,
  price: Price | null,
): Promise<{ code: string; off: number } | null> {
  const code = await codeOnVisit(db, visitId);
  if (code === null) return null;
  if (code.amountOff !== null) return { code: code.code, off: code.amountOff };
  if (price === null) return null;
  const after = await priceAfterCode(db, visitId, price);
  await db.batch(after.fix);
  return { code: code.code, off: after.off };
}

/**
 * What the client was sold the visit for: what they paid for it, or, for a visit no payment names, the price book's
 * price on the day it happened, less the discount code entered on it. And whether a referral credit paid for it, by
 * the ledger or by the hold that booked it.
 */
async function soldVisit(db: D1Database, visit: PricedVisit, off: number): Promise<SoldVisit> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT SUM(amount) FROM payments
           WHERE appointment_id = ?1 AND kind = 'visit' AND ${statusIn("status", PAYMENT_HELD)}) AS paid,
         ${creditSpentOn("?1")} AS with_credit`,
    )
    .bind(visit.id)
    .first<{ paid: number | null; with_credit: number }>();
  const paidWithCredit = row?.with_credit === 1;
  const paid = row?.paid ?? null;
  if (paid !== null) return { soldFor: paid, paidWithCredit };
  const price = await listPrice(db, visit);
  return { soldFor: price === null ? null : discounted(price, off).amount, paidWithCredit };
}

/** The price book's price for the visit's own service on the day it happened in India; null where there is none. */
function listPrice(db: D1Database, visit: PricedVisit): Promise<Price | null> {
  if (visit.type === null || visit.window_start === null) return Promise.resolve(null);
  return priceOf(db, visit.type, indiaDate(new Date(visit.window_start)), visit.tier ?? STANDARD_TIER);
}

// ---------------------------------------------------------------------------
// What ops are told
// ---------------------------------------------------------------------------

const linkTo = (visit: Visit): string => paymentsTab(visit.person_id);
const named = (invoice: BooksInvoice): string => `${invoice.number} (${invoice.id})`;

/** The draft's alert, saying why it is held. It shares the draft's key, so a visit is told of once. */
async function tellHeld(
  pass: Pass,
  visit: Visit,
  invoice: BooksInvoice,
  hold: InvoiceHold,
  sold: SoldVisit,
): Promise<void> {
  const held = `Invoice ${named(invoice)} of visit ${visit.id} is held as a draft in Books:`;
  const why: Record<InvoiceHold, string> = {
    price_differs:
      `it totals ${rupees(invoice.total)}, and the visit was sold for ${rupees(sold.soldFor ?? 0)}. ` +
      "Correct the draft in Books: once it totals what was sold, it is sent within the hour.",
    price_unknown:
      `nothing here says what the visit was sold for, so its ${rupees(invoice.total)} cannot be checked. ` +
      "Check the draft in Books and send it there.",
    paid_with_credit:
      "the visit was paid with a referral credit, and how such a visit is invoiced waits for the accountant. " +
      "Leave the draft until then: nothing here sends it.",
  };
  await pass.deps.alertOnce({ key: `invoice_draft:${visit.id}`, message: `${held} ${why[hold]}`, link: linkTo(visit) });
}

async function tellNotSent(pass: Pass, visit: Visit, invoice: BooksInvoice): Promise<void> {
  await pass.deps.alertOnce({
    key: `invoice_draft:${visit.id}`,
    message:
      `Books would not mark invoice ${named(invoice)} sent, so visit ${visit.id} has no tax invoice the client can ` +
      "open. It is tried again within the hour, or send it in Books.",
    link: linkTo(visit),
  });
}

async function tellHandMade(pass: Pass, visit: Visit, invoice: BooksInvoice): Promise<void> {
  await pass.deps.alertOnce({
    key: `invoice_draft:${visit.id}`,
    message:
      `Invoice ${named(invoice)} of visit ${visit.id} is still a draft in Books an hour after the visit, so the ` +
      "client cannot open it. It was not raised here: send it in Books, since nothing here sends a draft made by hand.",
    link: linkTo(visit),
  });
}

async function tellVoid(pass: Pass, visit: Visit, invoice: BooksInvoice): Promise<void> {
  await pass.deps.alertOnce({
    key: `invoice_draft:${visit.id}`,
    message:
      `Invoice ${named(invoice)} of visit ${visit.id} is void in Books, so the client has no tax invoice for it. ` +
      "Nothing here raises another: raise one in Books by hand if it is owed.",
    link: linkTo(visit),
  });
}

async function tellUnpriced(pass: Pass, visit: Visit): Promise<void> {
  pass.log.warn("invoice_unpriced", { appointment_id: visit.id, type: visit.type, tier: visit.tier });
  await pass.deps.alertOnce({
    key: `invoice_unpriced:${visit.id}`,
    message:
      `Visit ${visit.id} has no price in the price book for its day, so no invoice was raised for it. Raise it in ` +
      "Books by hand.",
    link: linkTo(visit),
  });
}

/** Logs it, and tells ops of a refusal at once and of any other failure on its third time. */
async function tellFailure(pass: Pass, visit: Visit, error: unknown): Promise<void> {
  if (isRefusal(error)) {
    pass.log.warn("invoice_refused", { appointment_id: visit.id, status: error.status, code: error.code });
    await pass.deps.alertOnce({
      key: `invoice_refused:${visit.id}`,
      message:
        `Books refused the invoice of visit ${visit.id}, saying "${error.said}". It is tried again each hour, or ` +
        "raise it in Books by hand.",
      link: linkTo(visit),
    });
    return;
  }
  pass.log.warn("invoice_failed", { appointment_id: visit.id, error });
  await pass.deps.alertOnce({
    key: `invoice_failed:${visit.id}`,
    message: `The invoice pass has failed ${String(FAILURES_BEFORE_ALERT)} times on visit ${visit.id}: ${failureReason(error, 200)}.`,
    link: linkTo(visit),
    after: FAILURES_BEFORE_ALERT,
  });
}

function endedOverAnHourAgo(pass: Pass, visit: Visit): boolean {
  if (visit.window_end === null) return true;
  return pass.now.getTime() - Date.parse(visit.window_end) > DRAFT_ALERT_AFTER_MS;
}

/** The client may see it now, and whatever ops were told about it is over. */
async function markIssued(pass: Pass, appointmentId: string): Promise<void> {
  await pass.db
    .prepare("UPDATE appointments SET invoice_issued_at = ?1 WHERE id = ?2")
    .bind(pass.now.toISOString(), appointmentId)
    .run();
  for (const kind of ["invoice_draft", "invoice_refused", "invoice_failed", "invoice_unpriced"]) {
    await pass.deps.resolveAlert(`${kind}:${appointmentId}`);
  }
}
