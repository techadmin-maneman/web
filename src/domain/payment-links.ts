// The payment link a consultation and fit in one visit is paid by, once the client is fitted
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md; src/policy/one-visit.ts).
//
// It is made when the technician closes the visit as done, for the product the client chose, at its price in the
// price book on the visit's day, less any discount code entered on the booking before GST
// (docs/decisions/0108-discount-codes.md), and Razorpay texts it to the client itself. A visit has one link, and its row is
// written before Razorpay is asked, with the reference its payment will have (src/domain/payments.ts), which the client
// reads on Razorpay's page. The close asks once and lands whatever Razorpay answers, so a phone is never held
// up by it; a link the close could not have made, for a timeout, a 5xx or a missing key, is asked for again by the
// five-minute cron, a few a run. Razorpay refuses a second link under the same reference, which is what a try whose
// answer never came leaves behind, so a refusal first looks for the link by its reference and keeps it if it is
// there. A link Razorpay refuses outright is not asked for again, and ops are told once, with the visit's ID as the
// reference of the link they then make by hand. Until it is paid, the Tasks board lists it (src/domain/tasks.ts).
//
// Paid, Razorpay's webhook says so (src/routes/razorpay-hook.ts), or the cron finds it paid when the webhook never
// came (src/domain/razorpay-catch-up.ts): the payment is the visit's, as a payment made ahead is, and follows the same
// path to Books (src/domain/books-sync.ts). A link ops made by hand finds the visit by its reference, the visit's ID.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { CallBudget } from "../lib/call-budget.ts";
import { indiaDate } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments.ts";
import { isRefusal } from "../providers/provider-error.ts";
import type { RazorpayPayment, RazorpayPaymentLink } from "../providers/razorpay.ts";
import type { AlertOnce, ResolveAlert } from "./alerts.ts";
import { codeAsRead, priceAfterCode } from "./discount-code-uses.ts";
import { recordPayment, referenceLink } from "./payments.ts";
import { priceOf } from "./price-book.ts";
import { serviceOf } from "./services.ts";
import { visitMessage } from "./visit-messages.ts";

/** What asking for the link came to; "free" when a discount code left nothing to pay, so no link was asked for. */
export type LinkSent = "sent" | "already_sent" | "unpriced" | "refused" | "unavailable" | "free";

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
  /** Null on a link written before links carried their payment's reference. */
  reference: string | null;
  sent_at: string | null;
  refused_at: string | null;
}

/** How many unsent links one cron run asks Razorpay for at most. */
export const LINKS_PER_PASS = 5;

/** Outside calls one link may cost: its making, and the look for one Razorpay says it already made. */
export const CALLS_PER_LINK = 2;

/** A failure other than a refusal is told once it has happened this many times, five minutes apart. */
const FAILURES_BEFORE_ALERT = 3;

const refusedKey = (appointmentId: string) => `payment_link:${appointmentId}`;
const failedKey = (appointmentId: string) => `payment_link_failed:${appointmentId}`;

const LINK_COLUMNS = "id, amount, reference, sent_at, refused_at";

/** The link's reference at Razorpay: its payment's, or the visit's ID on a link written before links had one. */
const referenceOf = (link: LinkRow, visit: FittedVisit) => link.reference ?? visit.appointmentId;

/** What the client reads they are paying for: "Mane Man Natural hair system". */
function hairSystemName(product: string | undefined): string {
  if (product === undefined) return "Hair system";
  return /hair system$/i.test(product) ? product : `${product} hair system`;
}

/** What the visit's link came to: the row, nothing to pay, no price in the book, or a code changing as it was made. */
type LinkFor =
  { readonly kind: "link"; readonly row: LinkRow } | { readonly kind: "free" | "unpriced" | "code_changing" };

/** A code going on or coming off the visit as its link is written makes the link be read again, this many times. */
const LINK_TRIES = 3;

/**
 * The visit's link, or a new one for the product at its price on the visit's day, less the visit's discount code
 * before GST. What the code takes off is fixed in the batch that writes the link, which is written only while the code
 * is still the one read. A code that leaves nothing to pay settles the visit instead, with no link and nothing owed,
 * and the client told on WhatsApp (docs/decisions/0108-discount-codes.md).
 */
async function linkFor(db: D1Database, visit: FittedVisit, now: Date): Promise<LinkFor> {
  const current = () =>
    db
      .prepare(`SELECT ${LINK_COLUMNS} FROM payment_links WHERE appointment_id = ?1`)
      .bind(visit.appointmentId)
      .first<LinkRow>();
  for (let tries = 0; tries < LINK_TRIES; tries += 1) {
    const existing = await current();
    if (existing !== null) return { kind: "link", row: existing };
    const listed = await priceOf(db, "first_fit", visit.day, visit.tier);
    if (listed === null) return { kind: "unpriced" };
    const after = await priceAfterCode(db, visit.appointmentId, listed);
    if (after.price.amount === 0) {
      await settleFree(db, visit, after.fix, now);
      return { kind: "free" };
    }
    // Another close of the same visit may write it first; either way the row is the visit's one.
    const linkId = crypto.randomUUID();
    await db.batch([
      ...after.fix,
      db
        .prepare(
          `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, created_at,
             updated_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE ${codeAsRead("?2", "?8")}
           ON CONFLICT (appointment_id) DO NOTHING`,
        )
        .bind(
          linkId,
          visit.appointmentId,
          visit.tier,
          after.price.amount,
          after.price.amount_ex_gst,
          after.price.gst_percent,
          now.toISOString(),
          after.useId,
        ),
      referenceLink(db, linkId, now),
    ]);
  }
  const written = await current();
  return written === null ? { kind: "code_changing" } : { kind: "link", row: written };
}

/**
 * A one visit a discount code made free: what the code took is fixed, nothing is owed, so no link and no task, and
 * the client is told on WhatsApp, once, as a paid visit's client is. The message is queued here and the sweeper sends
 * it within minutes, as it sends any the queue never had. The visit is marked as owing nothing, which settles an
 * invited friend's referral as a payment would (src/domain/referral-grants.ts).
 */
async function settleFree(
  db: D1Database,
  visit: FittedVisit,
  fix: readonly D1PreparedStatement[],
  now: Date,
): Promise<void> {
  const told = await db
    .prepare("SELECT 1 FROM outbound_messages WHERE subject_id = ?1 AND kind = 'nothing_to_pay'")
    .bind(visit.appointmentId)
    .first();
  const message = visitMessage(db, {
    personId: visit.personId,
    appointmentId: visit.appointmentId,
    kind: "nothing_to_pay",
    now,
  });
  await db.batch([
    ...fix,
    db
      .prepare("UPDATE appointments SET nothing_owed_at = COALESCE(nothing_owed_at, ?2) WHERE id = ?1")
      .bind(visit.appointmentId, now.toISOString()),
    ...(told === null ? [message.statement] : []),
  ]);
}

/** The visit's link at its close: written once, then asked of Razorpay once; what could not be made waits for the cron. */
export async function sendPaymentLink(
  db: D1Database,
  deps: LinkDeps,
  visit: FittedVisit,
  now: Date,
): Promise<LinkSent> {
  const made = await linkFor(db, visit, now);
  if (made.kind === "free") return "free";
  if (made.kind !== "link") {
    await deps.alertOnce({
      key: refusedKey(visit.appointmentId),
      message: `${notMade(visit, made.kind)} Send the client a link from Razorpay's dashboard with reference ${visit.appointmentId}.`,
      link: `/clients/${visit.personId}`,
    });
    return made.kind === "unpriced" ? "unpriced" : "unavailable";
  }
  const link = made.row;
  if (link.sent_at !== null) return "already_sent";
  if (link.refused_at !== null) return "refused";
  return askRazorpay(db, deps, link, visit, now);
}

/** Why a one visit's link was not made, for ops. */
function notMade(visit: FittedVisit, why: "unpriced" | "code_changing"): string {
  const fitted = `Visit ${visit.appointmentId} was a consultation and fit, and the client was fitted with ${visit.tier}`;
  if (why === "unpriced")
    return `${fitted}, which the price book has no price for that day, so no payment link was sent. Price it first.`;
  return `${fitted}; a discount code went on or came off it each time its payment link was written, so none was sent.`;
}

interface UnsentRow extends LinkRow {
  appointment_id: string;
  tier: string;
  person_id: string | null;
  window_start: string;
}

/**
 * The links a close could not have made, asked of Razorpay again, oldest first: a few a run, each paid for from the
 * run's outside calls first. Answers how many were made.
 */
export async function sendUnsentLinks(db: D1Database, deps: LinkDeps, now: Date, budget: CallBudget): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.amount, l.reference, l.sent_at, l.refused_at, l.appointment_id, l.tier, a.person_id,
         a.window_start
       FROM payment_links l JOIN appointments a ON a.id = l.appointment_id
       WHERE l.sent_at IS NULL AND l.refused_at IS NULL
       ORDER BY l.created_at LIMIT ?1`,
    )
    .bind(LINKS_PER_PASS)
    .all<UnsentRow>();
  let sent = 0;
  for (const row of results) {
    if (row.person_id === null) continue;
    if (!budget.spend(CALLS_PER_LINK)) break;
    const visit = {
      appointmentId: row.appointment_id,
      personId: row.person_id,
      tier: row.tier,
      day: indiaDate(new Date(row.window_start)),
    };
    if ((await askRazorpay(db, deps, row, visit, now)) === "sent") sent += 1;
  }
  return sent;
}

/** Asks Razorpay to make the link and text it to the client; never throws. */
async function askRazorpay(
  db: D1Database,
  deps: LinkDeps,
  link: LinkRow,
  visit: FittedVisit,
  now: Date,
): Promise<Extract<LinkSent, "sent" | "refused" | "unavailable">> {
  const client = await db
    .prepare("SELECT name, mobile_e164 FROM people WHERE id = ?1")
    .bind(visit.personId)
    .first<{ name: string; mobile_e164: string }>();
  const product = await serviceOf(db, "first_fit", visit.tier);
  try {
    const made = await deps.payments.createPaymentLink({
      amount: link.amount,
      reference: referenceOf(link, visit),
      description: `${hairSystemName(product?.name)} · fitted ${shortDate(visit.day)}`,
      customer: { name: client?.name ?? "", contact: client?.mobile_e164 ?? "" },
      notes: { appointment_id: visit.appointmentId, person_id: visit.personId },
    });
    await keepLink(db, deps, { link, visit, made }, now);
    return "sent";
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("payment_link_failed", { appointment_id: visit.appointmentId, reason });
    if (isRefusal(error)) return refusedOrMadeBefore(db, deps, { link, visit, reason }, now);
    await tellFailure(deps, visit, reason);
    return "unavailable";
  }
}

/**
 * A refusal. Razorpay refuses a second link under a reference it already holds, which a try whose answer never came
 * leaves behind: that link is the visit's, already texted to the client, and is kept. Any other is refused for good,
 * and ops are told once.
 */
async function refusedOrMadeBefore(
  db: D1Database,
  deps: LinkDeps,
  refused: { readonly link: LinkRow; readonly visit: FittedVisit; readonly reason: string },
  now: Date,
): Promise<Extract<LinkSent, "sent" | "refused" | "unavailable">> {
  const { link, visit, reason } = refused;
  let madeBefore: { id: string; shortUrl: string } | null;
  try {
    madeBefore = await deps.payments.findPaymentLink(referenceOf(link, visit));
  } catch (error) {
    await tellFailure(deps, visit, failureReason(error));
    return "unavailable";
  }
  if (madeBefore !== null) {
    await keepLink(db, deps, { link, visit, made: madeBefore }, now);
    return "sent";
  }
  await db
    .prepare("UPDATE payment_links SET refused_at = ?2, updated_at = ?2 WHERE id = ?1")
    .bind(link.id, now.toISOString())
    .run();
  await deps.alertOnce({
    key: refusedKey(visit.appointmentId),
    message:
      `Razorpay would not make the payment link of ${rupees(link.amount)} for visit ${visit.appointmentId}: ` +
      `${reason}. Send the client one from Razorpay's dashboard with reference ${visit.appointmentId}, whose ` +
      "payment then finds the visit.",
    link: `/clients/${visit.personId}`,
  });
  return "refused";
}

/** The link Razorpay made, kept on its row, and whatever ops were told of it closed. */
async function keepLink(
  db: D1Database,
  deps: LinkDeps,
  kept: { readonly link: LinkRow; readonly visit: FittedVisit; readonly made: { id: string; shortUrl: string } },
  now: Date,
): Promise<void> {
  await db
    .prepare(
      "UPDATE payment_links SET razorpay_link_id = ?2, short_url = ?3, sent_at = ?4, updated_at = ?4 WHERE id = ?1",
    )
    .bind(kept.link.id, kept.made.id, kept.made.shortUrl, now.toISOString())
    .run();
  await deps.resolveAlert(failedKey(kept.visit.appointmentId));
  deps.log.info("payment_link_sent", { appointment_id: kept.visit.appointmentId });
}

/** A failure on the way, which the cron tries again: ops are told once it has happened three times. */
async function tellFailure(deps: LinkDeps, visit: FittedVisit, reason: string): Promise<void> {
  await deps.alertOnce({
    key: failedKey(visit.appointmentId),
    message:
      `The payment link for visit ${visit.appointmentId} could not be asked of Razorpay ` +
      `${String(FAILURES_BEFORE_ALERT)} times: ${reason}. It is asked again every five minutes.`,
    link: `/clients/${visit.personId}`,
    after: FAILURES_BEFORE_ALERT,
  });
}

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
      `SELECT a.id, a.person_id, l.id AS link_id FROM appointments a
       LEFT JOIN payment_links l ON l.appointment_id = a.id
       WHERE a.id = ?1`,
    )
    .bind(appointmentId)
    .first<{ id: string; person_id: string | null; link_id: string | null }>();
  return visit === null ? null : { linkId: visit.link_id, appointmentId: visit.id, personId: visit.person_id };
}

/**
 * The link paid, by the payment Razorpay names, once: a second word of the same payment changes nothing. The payment
 * takes the link's split before GST, as a payment made ahead takes its hold's, where the amounts agree.
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
  ]);
}

/**
 * A one visit's payment link paid: the payment recorded as the visit's, by the link it paid, whatever notes it
 * carries, and the link marked paid where the close made one; a link ops made by hand has no row of ours. False for
 * a link that names no visit of ours.
 */
export async function linkPaid(
  db: D1Database,
  paid: { readonly link: RazorpayPaymentLink; readonly payment: RazorpayPayment },
  hashSalt: string,
  now: Date,
): Promise<boolean> {
  const ours = await visitOfLink(db, { razorpayLinkId: paid.link.id, reference: paid.link.reference_id ?? null });
  if (ours === null) return false;
  const notes =
    ours.personId === null
      ? { appointment_id: ours.appointmentId }
      : { appointment_id: ours.appointmentId, person_id: ours.personId };
  await recordPayment(db, { ...paid.payment, notes }, "captured", hashSalt, now);
  if (ours.linkId === null) return true;
  const paidAt = new Date(paid.payment.created_at * 1000).toISOString();
  await markLinkPaid(db, ours.linkId, { razorpayPaymentId: paid.payment.id, paidAt }, now);
  return true;
}
