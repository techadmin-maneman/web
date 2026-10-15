// A visit paid by UPI at the visit, while online payment is off (docs/decisions/0208-paid-at-the-visit-by-upi.md).
// Ops booked it with nothing taken; the client pays Mane Man's UPI ID at the door, the technician never handling
// money; and ops record the payment here once it reaches the account, under the UPI transaction's reference, which
// sends the client their receipt. Such a payment never passed through Razorpay, so it is refunded by UPI too.

import { rupees } from "@maneman/web-kit/money";
import { firstNameOf } from "../../lib/names.ts";
import { type VisitType, VISIT_TYPE_NAMES } from "../../config/visit-types.ts";
import { statusIn, PAYMENT_HELD } from "../../config/statuses.ts";
import { auditStatement, opsEntry, type Written } from "../platform/audit.ts";
import { referencePayment } from "./payments.ts";
import { UPI_MARK } from "../../policy/upi.ts";
import { queueMessage } from "../messages/queued-messages.ts";
import type { Composed } from "../messages/visit-message-text.ts";

export type UpiRecorded =
  | { readonly kind: "recorded"; readonly paymentId: string }
  | { readonly kind: "not_due" | "already_paid" | "reference_used" };

/** What a visit paid at the visit still owes: its hold's price, until a payment for it is held. Null for none. */
async function dueAt(
  db: D1Database,
  visitId: string,
): Promise<{ personId: string; amount: number; amountExGst: number; gstPercent: number; paid: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT a.person_id, h.amount, h.amount_ex_gst, h.gst_percent,
         EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.kind = 'visit'
                   AND ${statusIn("p.status", PAYMENT_HELD)}) AS paid
       FROM appointments a JOIN slot_holds h ON h.appointment_id = a.id AND h.pay_at_visit = 1 AND h.state = 'booked'
       WHERE a.id = ?1 AND a.deleted_at IS NULL`,
    )
    .bind(visitId)
    .first<{ person_id: string; amount: number; amount_ex_gst: number; gst_percent: number; paid: number }>();
  if (row === null) return null;
  return {
    personId: row.person_id,
    amount: row.amount,
    amountExGst: row.amount_ex_gst,
    gstPercent: row.gst_percent,
    paid: row.paid === 1,
  };
}

/**
 * Records the client's UPI payment for a visit paid at the visit: its whole price, under the UPI transaction's
 * reference (`utr`), as captured, with the next receipt reference and the client's receipt queued, in one batch.
 */
export async function recordUpiPayment(
  db: D1Database,
  asked: { readonly visitId: string; readonly utr: string },
  written: Written,
): Promise<UpiRecorded> {
  const due = await dueAt(db, asked.visitId);
  if (due === null) return { kind: "not_due" };
  if (due.paid) return { kind: "already_paid" };
  const razorpayPaymentId = `${UPI_MARK}${asked.utr}`;
  const used = await db
    .prepare("SELECT 1 FROM payments WHERE razorpay_payment_id = ?1")
    .bind(razorpayPaymentId)
    .first();
  if (used !== null) return { kind: "reference_used" };

  const paymentId = crypto.randomUUID();
  const at = written.now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, method, status,
           captured_at, created_at, updated_at, kind, amount_ex_gst, gst_percent)
         VALUES (?1, ?2, ?3, ?4, ?5, 'INR', 'upi', 'captured', ?6, ?6, ?6, 'visit', ?7, ?8)`,
      )
      .bind(paymentId, due.personId, asked.visitId, razorpayPaymentId, due.amount, at, due.amountExGst, due.gstPercent),
    referencePayment(db, paymentId, written.now),
    queueMessage(db, {
      id: crypto.randomUUID(),
      personId: due.personId,
      kind: "upi_received",
      subject: { kind: "payment", id: paymentId },
      at,
    }),
    auditStatement(
      db,
      opsEntry(written, "payment.upi_record", { kind: "appointment", id: asked.visitId }, { payment_id: paymentId }),
      written.now,
    ),
  ]);
  return { kind: "recorded", paymentId };
}

/** The client's receipt for a UPI payment ops recorded: what they paid, for which visit, under which reference. */
export async function composeUpiReceived(db: D1Database, paymentId: string, personId: string): Promise<Composed> {
  const paid = await db
    .prepare(
      `SELECT pay.amount, pay.reference, a.type, p.name FROM payments pay
       JOIN appointments a ON a.id = pay.appointment_id JOIN people p ON p.id = pay.person_id
       WHERE pay.id = ?1 AND pay.person_id = ?2 AND pay.status = 'captured'`,
    )
    .bind(paymentId, personId)
    .first<{ amount: number; reference: string | null; type: VisitType; name: string }>();
  if (paid === null) return { skip: "no captured payment" };
  if (paid.reference === null) return { skip: "the payment has no reference yet" };
  return {
    template: "upi_received_v1",
    params: [
      firstNameOf(paid.name),
      VISIT_TYPE_NAMES[paid.type].toLowerCase(),
      "",
      "",
      "",
      rupees(paid.amount),
      paid.reference,
    ],
  };
}
