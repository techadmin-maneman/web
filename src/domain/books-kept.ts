// Money Books holds that no invoice will come to be set against, though some of it is kept: what a late cancel or
// replacement kept, a no-show's charge, and a late fee. Each Books pass (src/domain/books-sync.ts) tells ops of it once,
// and closes the alert once the payment has gone back in full.

import { rupees } from "@maneman/web-kit/money";
import { paymentsTab, type AlertOnce } from "./alerts.ts";
import { PER_PASS } from "./vendor-pass.ts";

interface KeptRow {
  id: string;
  person_id: string;
  books_payment_id: string;
  appointment_id: string | null;
  kind: "visit" | "late_fee";
  amount: number;
  refunded_amount: number;
  change: "cancelled" | "replaced" | null;
  change_kept: number | null;
  no_show_kept: number | null;
}

/**
 * Payments Books has that no invoice will ever be set against, though some of the money is kept: a visit's payment
 * part kept by a late cancel or replacement, or by a no-show's charge, and a late fee for moving a visit, which is
 * not the visit's price. What is kept sits in Books as the client's credit. A payment refunded in full keeps nothing,
 * and nor does a no-show charge refunded on the client's dispute, whose refund may not have landed yet.
 */
export async function keptMoney(db: D1Database): Promise<KeptRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.person_id, p.books_payment_id, p.appointment_id, p.kind, p.amount, p.refunded_amount,
         c.kind AS change, c.kept_amount AS change_kept, n.kept_amount AS no_show_kept
       FROM payments p
       LEFT JOIN visit_changes c ON c.payment_id = p.id AND c.kind IN ('cancelled', 'replaced') AND c.kept_amount > 0
       LEFT JOIN no_show_cases n ON n.appointment_id = p.appointment_id AND p.kind = 'visit'
         AND n.decision = 'charged' AND n.kept_amount > 0
         AND NOT EXISTS (SELECT 1 FROM no_show_disputes d WHERE d.case_id = n.id AND d.ruling = 'refunded')
       WHERE p.books_payment_id IS NOT NULL AND p.books_applied_at IS NULL AND p.amount > p.refunded_amount
         AND (p.kind = 'late_fee' OR c.id IS NOT NULL OR n.id IS NOT NULL)
       ORDER BY p.captured_at LIMIT ?1`,
    )
    .bind(PER_PASS)
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

/** What was kept, and why, in the words ops read. */
function keptFor(kept: KeptRow): string {
  const visit = kept.appointment_id ?? "unknown";
  if (kept.change !== null) return `visit ${visit} was ${kept.change} and ${rupees(kept.change_kept ?? 0)} of it kept`;
  if (kept.no_show_kept !== null) return `visit ${visit} was a no-show and ${rupees(kept.no_show_kept)} of it kept`;
  return `it is the late fee for moving visit ${visit}, and ${rupees(kept.amount - kept.refunded_amount)} of it kept`;
}

/** Told once: the payment is claimed as dealt with first, so an overlapping run does not tell it again. */
export async function tellKept(db: D1Database, alertOnce: AlertOnce, at: string, kept: KeptRow): Promise<void> {
  const claimed = await db
    .prepare("UPDATE payments SET books_applied_at = ?1 WHERE id = ?2 AND books_applied_at IS NULL RETURNING id")
    .bind(at, kept.id)
    .first();
  if (claimed === null) return;
  await tellUnapplied(alertOnce, kept, keptFor(kept));
}

/**
 * Ops settle it by hand. How kept money is invoiced, so that it does not
 * stay the client's credit, waits for the CA (docs/open-points.md, item 16).
 */
export async function tellUnapplied(
  alertOnce: AlertOnce,
  payment: { id: string; person_id: string; books_payment_id: string },
  why: string,
): Promise<void> {
  await alertOnce({
    key: `books_unapplied:${payment.id}`,
    message:
      `Payment ${payment.id} (Books ${payment.books_payment_id}) has nothing to be set against: ${why}. ` +
      "It stays in Books as credit owed to the client until it is settled by hand.",
    link: paymentsTab(payment.person_id),
  });
}
