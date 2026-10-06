// A payment link paid (./payment-links.ts): the visit it pays for, found by the link or by its reference, the link
// marked paid with its receipt, a link cancelled once the visit was paid another way, and the receipt's text.

import { rupees } from "@maneman/web-kit/money";
import { firstNameOf } from "../../lib/names.ts";
import { failureReason } from "../../log.ts";
import { closedIfSentBy } from "../../policy/one-visit.ts";
import type { RazorpayPaymentLink, RazorpayPayment } from "../../providers/payments/razorpay.ts";
import { serviceOf } from "../booking/services.ts";
import type { Composed } from "../messages/visit-message-text.ts";
import { paymentsTab } from "../ops/alerts.ts";
import { type LinkDeps, hairSystemName } from "./payment-links.ts";
import { recordPayment } from "./payments.ts";

/** The link a payment paid, by Razorpay's ID for it, and its reference: ours, or the visit's ID on one made by hand. */
interface PaidLink {
  readonly razorpayLinkId: string;
  readonly reference: string | null;
}

/** The visit a paid link was for, its client, and its row, where the close made one; null for a link not ours. */
interface PaidVisit {
  readonly linkId: string | null;
  readonly appointmentId: string;
  readonly personId: string | null;
  /** The link the close made, by Razorpay's ID for it, and when Razorpay made it; null where none was made. */
  readonly ownLink: { readonly razorpayLinkId: string; readonly sentAt: string } | null;
}

/**
 * The visit a link was for: the one whose row the link is, by Razorpay's ID for it or by its reference, else the one
 * its reference names, as a link ops made by hand in Razorpay's dashboard does. Null for a link that names no visit
 * of ours.
 */

async function visitOfLink(db: D1Database, link: PaidLink): Promise<PaidVisit | null> {
  const made = await db
    .prepare("SELECT appointment_id FROM payment_links WHERE razorpay_link_id = ?1 OR reference = ?2")
    .bind(link.razorpayLinkId, link.reference)
    .first<{ appointment_id: string }>();
  const appointmentId = made?.appointment_id ?? link.reference;
  if (appointmentId === null) return null;
  const visit = await db
    .prepare(
      `SELECT a.id, a.person_id, l.id AS link_id, l.razorpay_link_id, l.sent_at FROM appointments a
       LEFT JOIN payment_links l ON l.appointment_id = a.id
       WHERE a.id = ?1`,
    )
    .bind(appointmentId)
    .first<VisitOfLinkRow>();
  if (visit === null) return null;
  return { linkId: visit.link_id, appointmentId: visit.id, personId: visit.person_id, ownLink: ownLinkOf(visit) };
}

interface VisitOfLinkRow {
  id: string;
  person_id: string | null;
  link_id: string | null;
  razorpay_link_id: string | null;
  sent_at: string | null;
}

function ownLinkOf(row: VisitOfLinkRow): PaidVisit["ownLink"] {
  if (row.razorpay_link_id === null || row.sent_at === null) return null;
  return { razorpayLinkId: row.razorpay_link_id, sentAt: row.sent_at };
}

/**
 * The visit's own link, cancelled once the visit is paid by another, as one ops made by hand, so that it neither
 * takes a second payment nor reminds the client. One closed by its time is left alone; one Razorpay will not cancel
 * is left to ops, who check whether the client paid it too. Never throws.
 */

export async function cancelLinkPaidElsewhere(
  deps: Pick<LinkDeps, "payments" | "alertOnce" | "log">,
  paid: { readonly visit: PaidVisit; readonly razorpayLinkId: string },
  now: Date,
): Promise<void> {
  const { visit } = paid;
  const own = visit.ownLink;
  if (own === null || own.razorpayLinkId === paid.razorpayLinkId) return;
  if (own.sentAt <= closedIfSentBy(now).toISOString()) return;
  try {
    await deps.payments.cancelPaymentLink(own.razorpayLinkId);
    deps.log.info("payment_link_cancelled", { appointment_id: visit.appointmentId });
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("payment_link_not_cancelled", { appointment_id: visit.appointmentId, reason });
    await deps.alertOnce({
      key: `paid_elsewhere_link:${own.razorpayLinkId}`,
      message:
        `Visit ${visit.appointmentId} was paid by another link, and its own payment link ${own.razorpayLinkId} ` +
        `could not be cancelled: ${reason}. Cancel it in Razorpay's dashboard; if the client paid it too, refund one.`,
      ...(visit.personId === null ? {} : { link: paymentsTab(visit.personId) }),
    });
  }
}

/**
 * The link paid, by the payment Razorpay names, once: a second word of the same payment changes nothing. The payment
 * takes the link's split before GST, as a payment made ahead takes its hold's, where the amounts agree. The client's
 * receipt is queued in the same batch, once, and the sweeper sends it within minutes.
 */

async function markLinkPaid(
  db: D1Database,
  linkId: string,
  payment: { readonly razorpayPaymentId: string; readonly paidAt: string },
  now: Date,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE payment_links SET razorpay_payment_id = ?2, paid_at = ?3, updated_at = ?4
         WHERE id = ?1 AND paid_at IS NULL`,
      )
      .bind(linkId, payment.razorpayPaymentId, payment.paidAt, now.toISOString()),
    db
      .prepare(
        `UPDATE payments SET
           amount_ex_gst = COALESCE(amount_ex_gst, (SELECT amount_ex_gst FROM payment_links WHERE id = ?1)),
           gst_percent = COALESCE(gst_percent, (SELECT gst_percent FROM payment_links WHERE id = ?1))
         WHERE razorpay_payment_id = ?2 AND amount = (SELECT amount FROM payment_links WHERE id = ?1)`,
      )
      .bind(linkId, payment.razorpayPaymentId),
    linkReceipt(db, linkId, now),
  ]);
}

/**
 * A one visit's payment link paid: the payment recorded as the visit's, by the link it paid, whatever notes it
 * carries, and the link marked paid where the close made one; a link ops made by hand has no row of ours. Answers the
 * visit, or null for a link that names no visit of ours.
 */

export async function linkPaid(
  db: D1Database,
  paid: { readonly link: RazorpayPaymentLink; readonly payment: RazorpayPayment },
  hashSalt: string,
  now: Date,
): Promise<PaidVisit | null> {
  const ours = await visitOfLink(db, { razorpayLinkId: paid.link.id, reference: paid.link.reference_id ?? null });
  if (ours === null) return null;
  const notes =
    ours.personId === null
      ? { appointment_id: ours.appointmentId }
      : { appointment_id: ours.appointmentId, person_id: ours.personId };
  await recordPayment({ db, payment: { ...paid.payment, notes }, status: "captured", hashSalt, now });
  if (ours.linkId === null) return ours;
  const paidAt = new Date(paid.payment.created_at * 1000).toISOString();
  await markLinkPaid(db, ours.linkId, { razorpayPaymentId: paid.payment.id, paidAt }, now);
  return ours;
}

/** The client's receipt for the link's visit, written unless one already is. */
function linkReceipt(db: D1Database, linkId: string, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       SELECT ?2, ?3, a.person_id, 'link_paid', 'appointment', a.id, 'queued', ?3
       FROM payment_links l JOIN appointments a ON a.id = l.appointment_id
       WHERE l.id = ?1 AND a.person_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM outbound_messages m WHERE m.subject_id = a.id AND m.kind = 'link_paid')`,
    )
    .bind(linkId, crypto.randomUUID(), now.toISOString());
}

/** What the client's receipt for a link paid says: what they paid for their hair system, and its reference. */
export async function composeLinkPaid(db: D1Database, appointmentId: string, personId: string): Promise<Composed> {
  const paid = await db
    .prepare(
      `SELECT pay.amount, pay.reference, l.tier, p.name FROM payment_links l
       JOIN payments pay ON pay.razorpay_payment_id = l.razorpay_payment_id
       JOIN people p ON p.id = pay.person_id
       WHERE l.appointment_id = ?1 AND pay.person_id = ?2 AND pay.status = 'captured'`,
    )
    .bind(appointmentId, personId)
    .first<{ amount: number; reference: string | null; tier: string; name: string }>();
  if (paid === null) return { skip: "no captured payment for the link" };
  if (paid.reference === null) return { skip: "the payment has no reference yet" };
  const product = await serviceOf(db, "first_fit", paid.tier);
  const hairSystem = product === null ? "hair system" : hairSystemName(product.name);
  return {
    template: "link_paid_v1",
    params: [firstNameOf(paid.name), hairSystem, "", "", "", rupees(paid.amount), paid.reference],
  };
}
