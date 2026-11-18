// A charge we keep, invoiced in Books (docs/decisions/0261-razorpay-money-in-books.md): what a late cancel or
// replacement kept, a no-show's charge, and a late fee. Each Books pass (src/domain/books/books-sync.ts) raises the
// kept part's own invoice on the visit's Books item, GST included in it at the rate the payment was taken at, sends
// it, and sets the payment against it, so the money is the business's and not the client's credit. With GST on, one
// taken with no GST in its price is told to ops, as its invoice would carry none. A no-show's charge waits until its
// dispute window has closed with no dispute open, as a dispute may give it all back. An erased client's is told to ops
// instead.

import { STANDARD_TIER, VISIT_TYPE_NAMES, type VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import type { NewBooksInvoice } from "../../providers/books/index.ts";
import { paymentsTab, type AlertOnce } from "../platform/alerts.ts";
import { supplyFor } from "../cities/gst-registrations.ts";
import { claimToApply, closeFailures, markApplied, tellFailure, type Pass } from "./books-pass.ts";
import { titled } from "./books-invoices.ts";
import { PER_PASS } from "./vendor-pass.ts";
import { ALERT_WORDS } from "../../config/alert-words.ts";

/** Outside calls one kept charge may cost: the look for its invoice, its making, its sending, the payment set against it, and an alert. */
export const CALLS_PER_KEPT = 5;

/** Why the money was kept, which names the invoice's line. */
type KeptFor = "cancelled" | "replaced" | "no_show" | "late_fee";

const KEPT_NAMES: Readonly<Record<KeptFor, string>> = {
  cancelled: "Late cancellation charge",
  replaced: "Late change charge",
  no_show: "No-show charge",
  late_fee: "Late move charge",
};

interface KeptRow {
  id: string;
  person_id: string;
  books_payment_id: string;
  books_customer_id: string;
  appointment_id: string;
  kind: "visit" | "late_fee";
  amount: number;
  refunded_amount: number;
  /** The GST in what was paid; null on a payment recorded before it was kept. */
  gst_percent: number | null;
  change: "cancelled" | "replaced" | null;
  change_kept: number | null;
  no_show_kept: number | null;
  type: VisitType;
  tier: string | null;
  service_city: string | null;
  books_item_id: string | null;
  /** 1 where the client has been erased since, whose charge ops settle by hand. */
  erased: number;
}

/**
 * Payments Books has that no visit's invoice will ever be set against, though some of the money is kept: a visit's
 * payment part kept by a late cancel or replacement, or by a no-show's charge, and a late fee for moving a visit,
 * which is not the visit's price. A payment refunded in full keeps nothing, and nor does a no-show charge refunded
 * on the client's dispute, whose refund may not have landed yet.
 */
export async function keptMoney(pass: Pass): Promise<KeptRow[]> {
  const { results } = await pass.db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, pe.books_customer_id, p.appointment_id, p.kind, p.amount,
         p.refunded_amount, p.gst_percent, c.kind AS change, c.kept_amount AS change_kept, n.kept_amount AS no_show_kept,
         a.type, a.tier, a.service_city, s.books_item_id, pe.erased_at IS NOT NULL AS erased
       FROM payments p JOIN people pe ON pe.id = p.person_id JOIN appointments a ON a.id = p.appointment_id
       LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, ?3)
       LEFT JOIN visit_changes c ON c.payment_id = p.id AND c.kind IN ('cancelled', 'replaced') AND c.kept_amount > 0
       LEFT JOIN no_show_cases n ON n.appointment_id = p.appointment_id AND p.kind = 'visit'
         AND n.decision = 'charged' AND n.kept_amount > 0
         AND NOT EXISTS (SELECT 1 FROM no_show_disputes d WHERE d.case_id = n.id AND d.ruling = 'refunded')
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL AND p.amount > p.refunded_amount
         AND pe.books_customer_id IS NOT NULL
         AND (p.kind = 'late_fee' OR c.id IS NOT NULL OR n.id IS NOT NULL)
         AND (n.id IS NULL OR (n.dispute_until < ?1
           AND NOT EXISTS (SELECT 1 FROM no_show_disputes d WHERE d.case_id = n.id AND d.ruling IS NULL)))
         AND (p.books_checked_at IS NULL OR p.books_checked_at < ?2)
       ORDER BY p.captured_at LIMIT ?4`,
    )
    .bind(pass.at, pass.recheck, STANDARD_TIER, PER_PASS)
    .all<KeptRow>();
  return results;
}

/** Kept money ops were told of, since refunded in full: nothing is left to settle by hand. */
export async function keptSinceRefunded(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id FROM alerts a JOIN payments p ON p.id = substr(a.key, 17)
       WHERE a.resolved_at IS NULL AND a.key > 'books_unapplied:' AND a.key < 'books_unapplied;'
         AND p.refunded_amount >= p.amount LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<{ id: string }>();
  return results.map((row) => row.id);
}

const keptForOf = (kept: KeptRow): KeptFor => kept.change ?? (kept.kind === "late_fee" ? "late_fee" : "no_show");

/** What is kept: the charge's own figure, never more than the payment holds once its refunds are out. */
function keptAmount(kept: KeptRow): number {
  const held = kept.amount - kept.refunded_amount;
  return Math.min(held, kept.change_kept ?? kept.no_show_kept ?? held);
}

/** The kept part's invoice, under the payment's ID: one line on the visit's item, the amount GST included. */
async function keptInvoice(pass: Pass, kept: KeptRow, itemId: string): Promise<NewBooksInvoice> {
  const supply = (await supplyFor(pass.db, pass.options.gst))(kept.service_city);
  return {
    customerId: kept.books_customer_id,
    reference: kept.id,
    date: indiaDate(new Date(pass.at)),
    placeOfSupply: supply.placeOfSupply,
    branchId: supply.branchId,
    line: {
      itemId,
      name: `${KEPT_NAMES[keptForOf(kept)]}, ${titled(VISIT_TYPE_NAMES[kept.type])}`,
      description: pass.options.labelAsTest ? "Staging test" : "",
      rate: keptAmount(kept),
      discount: 0,
      tax: pass.options.gst.gstin === null ? null : { percent: kept.gst_percent ?? 0, intraState: supply.intraState },
    },
  };
}

/** True when the kept part is invoiced and the payment set against it now. */
export async function invoiceKept(pass: Pass, kept: KeptRow): Promise<boolean> {
  if (!(await claimToApply(pass, kept.id))) return false;
  const failed = {
    kind: "kept",
    id: kept.id,
    personId: kept.person_id,
    what: `the invoice of what payment ${kept.id} kept`,
    then: "It is asked again every hour.",
  } as const;
  if (kept.erased === 1) {
    await tellUnapplied(pass.deps.alertOnce, kept, "the client was erased before its invoice was raised");
    await markApplied(pass, kept.id);
    return false;
  }
  if (pass.options.gst.gstin !== null && (kept.gst_percent ?? 0) === 0) {
    await tellUnapplied(pass.deps.alertOnce, kept, "it was taken with no GST in its price");
    await markApplied(pass, kept.id);
    return false;
  }
  // The hourly item check tells ops of a service Books has no item for.
  if (kept.books_item_id === null) {
    pass.log.warn("kept_item_missing", { payment_id: kept.id, type: kept.type, tier: kept.tier });
    return false;
  }
  try {
    const { books } = pass.deps;
    // An earlier try whose answer never came may have raised it already.
    const invoice =
      (await books.findInvoice(kept.id)) ??
      (await books.createInvoice(await keptInvoice(pass, kept, kept.books_item_id)));
    await pass.db
      .prepare("UPDATE payments SET books_kept_invoice_id = ?1 WHERE id = ?2")
      .bind(invoice.id, kept.id)
      .run();
    if (invoice.status === "void") {
      await tellUnapplied(pass.deps.alertOnce, kept, `its invoice ${invoice.id} is void`);
      await markApplied(pass, kept.id);
      return false;
    }
    if (invoice.status === "draft") await books.issueInvoice(invoice.id);
    if (invoice.balance > 0) {
      await books.applyToInvoice(kept.books_payment_id, invoice.id, Math.min(invoice.balance, keptAmount(kept)));
    }
  } catch (error) {
    await tellFailure(pass, failed, error);
    return false;
  }
  await markApplied(pass, kept.id);
  await closeFailures(pass, failed);
  return true;
}

/** Ops settle it by hand: refund it, or keep it in Books as the client's credit. */
export async function tellUnapplied(
  alertOnce: AlertOnce,
  payment: { id: string; person_id: string; books_payment_id: string },
  why: string,
): Promise<void> {
  await alertOnce({
    key: `books_unapplied:${payment.id}`,
    message: ALERT_WORDS.books_unapplied({ what: `payment ${payment.id}`, why, books: payment.books_payment_id }),
    link: paymentsTab(payment.person_id),
  });
}
