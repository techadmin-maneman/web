// The payment link a consultation and fit in one visit is paid by, once the client is fitted
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md; src/policy/one-visit.ts).
//
// It is made when the technician closes the visit as done, for the product the client chose, at its price in the
// price book on the visit's day, and Razorpay texts it to the client itself. A visit has one link. Its row is written
// before Razorpay is asked, so a close the phone sends twice asks once. A try that failed on the way leaves the row
// unsent, and the close answers 503, so the phone sends it again and this asks again; one Razorpay refuses tells ops
// once, with the visit's ID for the link they make by hand, whose payment then still finds the visit. Until it is
// paid, the Tasks board lists it (src/domain/tasks.ts).
//
// Paid, Razorpay's webhook says so (src/routes/razorpay-hook.ts): the payment is the visit's, as a payment made
// ahead is, and follows the same path to Books (src/domain/books-sync.ts).

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { failureReason, type Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import { isRefusal } from "../providers/provider-error.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { priceOf } from "./price-book.ts";
import { serviceOf } from "./services.ts";

/** What asking for the link came to. */
export type LinkSent = "sent" | "already_sent" | "unpriced" | "refused" | "unavailable";

export interface LinkDeps {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  readonly log: Logger;
}

/** The visit a link is for: the client Razorpay texts it to, and the product they were fitted with. */
export interface FittedVisit {
  readonly appointmentId: string;
  readonly personId: string;
  /** The first fit's service the client chose, by its tier. */
  readonly tier: string;
  /** India's date of the visit, which prices it. */
  readonly day: string;
}

interface LinkRow {
  id: string;
  amount: number;
  sent_at: string | null;
}

const alertKey = (appointmentId: string) => `payment_link:${appointmentId}`;

/** The visit's link, or a new one for the product at its price on the visit's day; null where the book has no price. */
async function linkFor(db: D1Database, visit: FittedVisit, now: Date): Promise<LinkRow | null> {
  const existing = await db
    .prepare("SELECT id, amount, sent_at FROM payment_links WHERE appointment_id = ?1")
    .bind(visit.appointmentId)
    .first<LinkRow>();
  if (existing !== null) return existing;
  const price = await priceOf(db, "first_fit", visit.day, visit.tier);
  if (price === null) return null;
  const at = now.toISOString();
  // Another close of the same visit may write it first; either way the row is the visit's one.
  await db
    .prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
       ON CONFLICT (appointment_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      visit.appointmentId,
      visit.tier,
      price.amount,
      price.amount_ex_gst,
      price.gst_percent,
      at,
    )
    .run();
  return db
    .prepare("SELECT id, amount, sent_at FROM payment_links WHERE appointment_id = ?1")
    .bind(visit.appointmentId)
    .first<LinkRow>();
}

/** Asks Razorpay for the visit's payment link, once, and keeps it. */
export async function sendPaymentLink(
  db: D1Database,
  deps: LinkDeps,
  visit: FittedVisit,
  now: Date,
): Promise<LinkSent> {
  const link = await linkFor(db, visit, now);
  if (link === null) {
    await deps.alertOnce({
      key: alertKey(visit.appointmentId),
      message:
        `Visit ${visit.appointmentId} was a consultation and fit, and the client was fitted with ${visit.tier}, ` +
        "which the price book has no price for that day, so no payment link was sent. Price it, then send the " +
        `client a link from Razorpay's dashboard with reference ${visit.appointmentId}.`,
      link: `/clients/${visit.personId}`,
    });
    return "unpriced";
  }
  if (link.sent_at !== null) return "already_sent";

  const client = await db
    .prepare("SELECT name, mobile_e164 FROM people WHERE id = ?1")
    .bind(visit.personId)
    .first<{ name: string; mobile_e164: string }>();
  const product = await serviceOf(db, "first_fit", visit.tier);
  try {
    const made = await deps.payments.createPaymentLink({
      amount: link.amount,
      reference: visit.appointmentId,
      description: `${product?.name ?? "Your hair system"}, fitted ${shortDate(visit.day)}`,
      customer: { name: client?.name ?? "", contact: client?.mobile_e164 ?? "" },
      notes: { appointment_id: visit.appointmentId, person_id: visit.personId },
    });
    const at = now.toISOString();
    await db
      .prepare(
        "UPDATE payment_links SET razorpay_link_id = ?2, short_url = ?3, sent_at = ?4, updated_at = ?4 WHERE id = ?1",
      )
      .bind(link.id, made.id, made.shortUrl, at)
      .run();
    await deps.resolveAlert(alertKey(visit.appointmentId));
    deps.log.info("payment_link_sent", { appointment_id: visit.appointmentId });
    return "sent";
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("payment_link_failed", { appointment_id: visit.appointmentId, reason });
    if (!isRefusal(error)) return "unavailable";
    await deps.alertOnce({
      key: alertKey(visit.appointmentId),
      message:
        `Razorpay would not make the payment link of ${rupees(link.amount)} for visit ${visit.appointmentId}: ` +
        `${reason}. If Razorpay already holds a link with reference ${visit.appointmentId}, it is the client's; ` +
        `otherwise send them one from Razorpay's dashboard with that reference.`,
      link: `/clients/${visit.personId}`,
    });
    return "refused";
  }
}

/** The link a payment paid, by Razorpay's ID for it or by its reference, which is the visit's ID. */
export interface PaidLink {
  readonly razorpayLinkId: string;
  readonly reference: string | null;
}

/** The visit a link was for and its client, by the link; null for a link that is not ours. */
export async function visitOfLink(
  db: D1Database,
  link: PaidLink,
): Promise<{ readonly linkId: string; readonly appointmentId: string; readonly personId: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT l.id, l.appointment_id, a.person_id FROM payment_links l JOIN appointments a ON a.id = l.appointment_id
       WHERE l.razorpay_link_id = ?1 OR l.appointment_id = ?2`,
    )
    .bind(link.razorpayLinkId, link.reference)
    .first<{ id: string; appointment_id: string; person_id: string | null }>();
  return row === null ? null : { linkId: row.id, appointmentId: row.appointment_id, personId: row.person_id };
}

/**
 * The link paid, by the payment Razorpay names, once: a second word of the same payment changes nothing. The payment
 * takes the link's split before GST, as a payment made ahead takes its hold's, where the amounts agree.
 */
export async function markLinkPaid(
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
  ]);
}
