// Finance's Payments ledger: every payment over a period in the places reached, newest first, with who paid, for what,
// how, where it stands, what went back and whether Books has it; and the payment links still unpaid. Read from the
// rows Razorpay's webhook and the console's own UPI record already write (docs/decisions/0044-payments-mirror.md):
// nothing here is totalled or kept.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import type { PlacesReached } from "../../policy/access.ts";
import { reachBinding, withinReach } from "../clients/places.ts";

/** Where Books stands with a payment: recorded and applied, captured and still to reach it, or nothing for it. */
type InBooks = "applied" | "waiting" | "none";

export interface LedgerPayment {
  readonly id: string;
  readonly reference: string | null;
  /** Null for a payment with no client of ours, and for one whose client was erased. */
  readonly person: { readonly id: string; readonly name: string } | null;
  readonly kind: string;
  readonly method: string | null;
  readonly status: string;
  /** In paise. */
  readonly amount: number;
  /** In paise. */
  readonly refunded_amount: number;
  readonly created_at: string;
  readonly captured_at: string | null;
  readonly books: InBooks;
}

export interface UnpaidLink {
  readonly id: string;
  readonly reference: string | null;
  readonly person: { readonly id: string; readonly name: string } | null;
  /** In paise. */
  readonly amount: number;
  readonly created_at: string;
  readonly sent_at: string | null;
  readonly refused_at: string | null;
  /** When Razorpay stops taking it; a link past it is closed unpaid. */
  readonly closes_at: string | null;
}

interface PaymentRow extends Omit<LedgerPayment, "person" | "books"> {
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly erased: number;
  readonly applied: number;
}

interface LinkRow extends Omit<UnpaidLink, "person"> {
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly erased: number;
}

const personOf = (row: { person_id: string | null; person_name: string | null; erased: number }) =>
  row.person_id === null || row.person_name === null || row.erased === 1
    ? null
    : { id: row.person_id, name: row.person_name };

const booksOf = (row: PaymentRow): InBooks => {
  if (row.applied === 1) return "applied";
  return row.captured_at === null ? "none" : "waiting";
};

/** The payments made from the first day to the last, both India's dates and both counted, at most `cap` of them. */
export async function ledgerPayments(
  db: D1Database,
  period: { readonly from: string; readonly to: string },
  reached: PlacesReached,
  cap: number,
): Promise<LedgerPayment[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.reference, p.person_id, pe.name AS person_name, pe.erased_at IS NOT NULL AS erased, p.kind,
         p.method, p.status, p.amount, p.refunded_amount, p.created_at, p.captured_at,
         p.books_applied_at IS NOT NULL AS applied
       FROM payments p LEFT JOIN people pe ON pe.id = p.person_id
       WHERE p.created_at >= ?1 AND p.created_at < ?2 AND ${withinReach("payment", "p", "?3")}
       ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?4`,
    )
    .bind(
      indiaInstant(period.from, "00:00").toISOString(),
      indiaInstant(addDays(period.to, 1), "00:00").toISOString(),
      reachBinding(reached),
      cap,
    )
    .all<PaymentRow>();
  return results.map((row) => ({
    id: row.id,
    reference: row.reference,
    person: personOf(row),
    kind: row.kind,
    method: row.method,
    status: row.status,
    amount: row.amount,
    refunded_amount: row.refunded_amount,
    created_at: row.created_at,
    captured_at: row.captured_at,
    books: booksOf(row),
  }));
}

/** The payment links not yet paid in the places reached, the oldest first, at most `cap` of them. */
export async function unpaidLinks(db: D1Database, reached: PlacesReached, cap: number): Promise<UnpaidLink[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.reference, a.person_id, pe.name AS person_name, pe.erased_at IS NOT NULL AS erased, l.amount,
         l.created_at, l.sent_at, l.refused_at, l.closes_at
       FROM payment_links l JOIN appointments a ON a.id = l.appointment_id LEFT JOIN people pe ON pe.id = a.person_id
       WHERE l.paid_at IS NULL AND ${withinReach("payment_link", "l", "?1")}
       ORDER BY l.created_at, l.rowid LIMIT ?2`,
    )
    .bind(reachBinding(reached), cap)
    .all<LinkRow>();
  return results.map((row) => ({
    id: row.id,
    reference: row.reference,
    person: personOf(row),
    amount: row.amount,
    created_at: row.created_at,
    sent_at: row.sent_at,
    refused_at: row.refused_at,
    closes_at: row.closes_at,
  }));
}
