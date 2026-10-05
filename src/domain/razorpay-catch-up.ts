// What Razorpay's webhook never told us. The webhook is how we hear of a payment; when it stops arriving, a client's
// money would sit in Razorpay with nothing booked and nothing refunded. So the cron asks Razorpay about each payment we
// may have missed:
//
// - a hold paid at Checkout and never confirmed, once its grace has passed and the webhook has had a quarter of an
//   hour more, until three days after it ran out;
// - a hold ops sent a payment link for, from an hour after it was made until three days after it ran out;
// - a one visit's payment link, from an hour after it was sent until a week after it was made.
//
// Each is asked about at most once an hour, holds and links taking turns while the run's calls last. A payment found
// is recorded as its webhook would have recorded it, a hold it paid for goes to be booked, or refunded if its time has
// gone, and ops are told once for each payment we had not heard of.

import { rupees } from "@maneman/web-kit/money";
import type { CallBudget } from "../lib/call-budget.ts";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "../lib/durations.ts";
import { failureReason, type Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments/index.ts";
import type { RazorpayPayment, RazorpayPaymentLink } from "../providers/payments/razorpay.ts";
import { paymentsTab, type AlertOnce } from "./alerts.ts";
import { recordBookingConsents } from "./booking-consents.ts";
import { linkPaid } from "./payment-links.ts";
import { recordPayment } from "./payments.ts";
import { ASKS } from "./refunds.ts";
import { graceEnds } from "./hold-stages.ts";
import { recordHoldLinkPaid } from "./visit-booking.ts";
import { PAYMENT_TAKEN, statusIn } from "../config/statuses.ts";

/** Holds asked about in one run at most, and one visit's links the same. */
const CHECKS_PER_PASS = 5;

/** Reading a Checkout order's payments is one call; a link is read first, so two. */
const CALLS_PER_ORDER = 1;
const CALLS_PER_LINK = 2;

/** How long the webhook has, after a Checkout hold's grace ends, before Razorpay is asked. */
const WEBHOOK_WAIT_MS = 15 * MINUTE_MS;
/** How long after a link is sent before Razorpay is asked about it. */
const LINK_WAIT_MS = HOUR_MS;
/** How long after a hold runs out it is still asked about. */
const HOLD_ASKED_FOR_MS = 3 * DAY_MS;
/** How long after a one visit's link is made it is still asked about. */
const LINK_ASKED_FOR_MS = 7 * DAY_MS;
/** How often one hold or link is asked about. */
const ASKED_EVERY_MS = HOUR_MS;

const REQUEST_ID = "razorpay-catch-up";

/** What follows a payment found, as ops read it: for a hold, and for a one visit's link. */
const BOOKING_FOLLOWS = "It is recorded now, and the visit is booked, or refunded if its time has gone.";
const RECORDED = "It is recorded now as the visit's payment.";

interface CatchUpDeps {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly log: Logger;
  readonly hashSalt: string;
  /** Books a hold whose payment is now recorded, or refunds it if the payment came too late; throws when it cannot. */
  readonly book: (holdId: string) => Promise<unknown>;
}

interface HoldToAsk {
  readonly id: string;
  readonly person_id: string;
  readonly razorpay_order_id: string | null;
  /** Razorpay's ID for the link ops sent for it; null for a hold paid at Checkout. */
  readonly payment_link_id: string | null;
}

interface LinkToAsk {
  readonly id: string;
  readonly appointment_id: string;
  readonly person_id: string | null;
  readonly razorpay_link_id: string;
}

/** A link Razorpay holds as paid, and the payment that paid it. */
interface FoundPaid {
  readonly link: RazorpayPaymentLink;
  readonly payment: RazorpayPayment;
  readonly orderId: string;
}

/** One question for Razorpay: the calls it may take, and asking it, which answers whether a payment was found. */
interface Question {
  readonly calls: number;
  readonly ask: () => Promise<boolean>;
}

/** Asks Razorpay what its webhook may have missed, as far as the run's calls allow. Answers how many payments it found. */
export async function catchUpWithRazorpay(
  db: D1Database,
  deps: CatchUpDeps,
  budget: CallBudget,
  now: Date,
): Promise<number> {
  const aboutHolds = (await holdsToAsk(db, now)).map((hold): Question => ({
    calls: callsForHold(hold),
    ask: () => askAboutHold(db, deps, hold, now),
  }));
  const aboutLinks = (await linksToAsk(db, now)).map((link): Question => ({
    calls: CALLS_PER_LINK,
    ask: () => askAboutLink(db, deps, link, now),
  }));
  let found = 0;
  for (const question of takingTurns(aboutHolds, aboutLinks)) {
    if (!budget.spend(question.calls)) return found;
    if (await question.ask()) found += 1;
  }
  return found;
}

/** A hold, then a link, and so on, so that neither kind takes every call of a run while the other waits. */
function takingTurns(first: readonly Question[], second: readonly Question[]): Question[] {
  const turns: Question[] = [];
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const fromFirst = first[index];
    const fromSecond = second[index];
    if (fromFirst !== undefined) turns.push(fromFirst);
    if (fromSecond !== undefined) turns.push(fromSecond);
  }
  return turns;
}

/** Reading the hold's order or link, and the refund a payment made too late is given back by. */
function callsForHold(hold: HoldToAsk): number {
  const reading = hold.payment_link_id === null ? CALLS_PER_ORDER : CALLS_PER_LINK;
  return reading + ASKS;
}

const before = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

/** Holds never confirmed whose payment Razorpay may hold, those never asked about first, then the least lately asked. */
async function holdsToAsk(db: D1Database, now: Date): Promise<HoldToAsk[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.person_id, h.razorpay_order_id, h.payment_link_id FROM slot_holds h
       WHERE h.confirmed_at IS NULL AND h.expires_at > ?1
         AND (h.payment_checked_at IS NULL OR h.payment_checked_at <= ?2)
         AND ((h.pay_by_link = 0 AND h.razorpay_order_id IS NOT NULL AND ${graceEnds("h")} <= ?3)
           OR (h.pay_by_link = 1 AND h.payment_link_id IS NOT NULL AND h.created_at <= ?4))
       ORDER BY h.payment_checked_at IS NOT NULL, h.payment_checked_at, h.expires_at
       LIMIT ?5`,
    )
    .bind(
      before(now, HOLD_ASKED_FOR_MS),
      before(now, ASKED_EVERY_MS),
      before(now, WEBHOOK_WAIT_MS),
      before(now, LINK_WAIT_MS),
      CHECKS_PER_PASS,
    )
    .all<HoldToAsk>();
  return results;
}

/** One visit's links sent and unpaid, those never asked about first, then the least lately asked. */
async function linksToAsk(db: D1Database, now: Date): Promise<LinkToAsk[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.appointment_id, a.person_id, l.razorpay_link_id
       FROM payment_links l JOIN appointments a ON a.id = l.appointment_id
       WHERE l.paid_at IS NULL AND l.created_at > ?1 AND l.razorpay_link_id IS NOT NULL AND l.sent_at <= ?2
         AND (l.payment_checked_at IS NULL OR l.payment_checked_at <= ?3)
       ORDER BY l.payment_checked_at IS NOT NULL, l.payment_checked_at, l.created_at
       LIMIT ?4`,
    )
    .bind(before(now, LINK_ASKED_FOR_MS), before(now, LINK_WAIT_MS), before(now, ASKED_EVERY_MS), CHECKS_PER_PASS)
    .all<LinkToAsk>();
  return results;
}

/**
 * Asks about one hold: the payments on its Checkout order, or the link ops sent for it. Marked as asked first, so a
 * read that fails waits its hour like any other. True when a payment was found.
 */
async function askAboutHold(db: D1Database, deps: CatchUpDeps, hold: HoldToAsk, now: Date): Promise<boolean> {
  await db
    .prepare("UPDATE slot_holds SET payment_checked_at = ?2 WHERE id = ?1")
    .bind(hold.id, now.toISOString())
    .run();
  if (hold.payment_link_id !== null) return askAboutHoldLink(db, deps, { hold, linkId: hold.payment_link_id }, now);
  if (hold.razorpay_order_id === null) return false;
  return askAboutCheckout(db, deps, { hold, orderId: hold.razorpay_order_id }, now);
}

/** A Checkout order's captures we never heard of, each recorded as the webhook would have, then the hold sent on. */
async function askAboutCheckout(
  db: D1Database,
  deps: CatchUpDeps,
  asked: { readonly hold: HoldToAsk; readonly orderId: string },
  now: Date,
): Promise<boolean> {
  const { hold, orderId } = asked;
  const captures = await capturesNotHeard(db, deps.payments, orderId);
  if (captures.length === 0) return false;
  const notes = { hold_id: hold.id, person_id: hold.person_id };
  for (const payment of captures) {
    await recordPayment(db, { ...payment, notes }, "captured", deps.hashSalt, now);
    await tellFound(deps, { payment, paidFor: `booking ${hold.id}`, personId: hold.person_id, next: BOOKING_FOLLOWS });
  }
  await sendToBeBooked(deps, hold);
  await recordBookingConsents(db, { holdId: hold.id, requestId: REQUEST_ID, now });
  return true;
}

/**
 * The link ops sent for a hold, paid: its payment recorded on the hold, which confirms it, as the webhook would have,
 * and the hold sent on. Ops are told only of a payment we had not heard of at all.
 */
async function askAboutHoldLink(
  db: D1Database,
  deps: CatchUpDeps,
  asked: { readonly hold: HoldToAsk; readonly linkId: string },
  now: Date,
): Promise<boolean> {
  const { hold, linkId } = asked;
  const paid = await paidLink(deps.payments, linkId);
  if (paid === null) return false;
  const heard = await heardCaptured(db, paid.payment.id);
  const holdPaid = { hold: { id: hold.id, personId: hold.person_id }, payment: paid.payment, orderId: paid.orderId };
  await recordHoldLinkPaid(db, holdPaid, deps.hashSalt, now);
  if (!heard) {
    const paidFor = `booking ${hold.id}`;
    await tellFound(deps, { payment: paid.payment, paidFor, personId: hold.person_id, next: BOOKING_FOLLOWS });
  }
  await sendToBeBooked(deps, hold);
  return true;
}

/** A one visit's link, paid: its payment recorded as the visit's, and the link marked paid, as the webhook would have. */
async function askAboutLink(db: D1Database, deps: CatchUpDeps, link: LinkToAsk, now: Date): Promise<boolean> {
  await db
    .prepare("UPDATE payment_links SET payment_checked_at = ?2 WHERE id = ?1")
    .bind(link.id, now.toISOString())
    .run();
  const paid = await paidLink(deps.payments, link.razorpay_link_id);
  if (paid === null) return false;
  const heard = await heardCaptured(db, paid.payment.id);
  await linkPaid(db, { link: paid.link, payment: paid.payment }, deps.hashSalt, now);
  if (!heard) {
    const paidFor = `visit ${link.appointment_id}`;
    await tellFound(deps, { payment: paid.payment, paidFor, personId: link.person_id, next: RECORDED });
  }
  return true;
}

/**
 * Books the hold, or refunds it. One that cannot be is left to ops: a hold whose time had run out is no longer among
 * those the cron books again.
 */
async function sendToBeBooked(deps: CatchUpDeps, hold: HoldToAsk): Promise<void> {
  try {
    await deps.book(hold.id);
  } catch (error) {
    const reason = failureReason(error);
    deps.log.warn("razorpay_catch_up_not_booked", { hold_id: hold.id, reason });
    await deps.alertOnce({
      key: `razorpay_catch_up_not_booked:${hold.id}`,
      message:
        `Booking ${hold.id} is paid for, but could not be booked or refunded: ${reason}. Book the visit for the ` +
        "client, or refund the payment in Razorpay's dashboard.",
      link: paymentsTab(hold.person_id),
    });
  }
}

/** The link as Razorpay holds it, with the payment that paid it; null while it is unpaid. */
async function paidLink(payments: PaymentsProvider, linkId: string): Promise<FoundPaid | null> {
  const link = await payments.paymentLink(linkId);
  const orderId = link.order_id ?? null;
  if (link.status !== "paid" || orderId === null) return null;
  const payment = (await payments.orderPayments(orderId)).find((each) => each.status === "captured");
  if (payment === undefined) return null;
  return { link, payment, orderId };
}

/** The order's captured payments that we hold no capture of. */
async function capturesNotHeard(
  db: D1Database,
  payments: PaymentsProvider,
  orderId: string,
): Promise<RazorpayPayment[]> {
  const captured = (await payments.orderPayments(orderId)).filter((payment) => payment.status === "captured");
  const notHeard: RazorpayPayment[] = [];
  for (const payment of captured) {
    if (!(await heardCaptured(db, payment.id))) notHeard.push(payment);
  }
  return notHeard;
}

/** Whether we hold the payment as captured, or refunded since. */
async function heardCaptured(db: D1Database, razorpayPaymentId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM payments
       WHERE razorpay_payment_id = ?1 AND ${statusIn("status", PAYMENT_TAKEN)}`,
    )
    .bind(razorpayPaymentId)
    .first();
  return row !== null;
}

/** Ops, once a payment: it reached us only by asking Razorpay, which says its webhook is not reaching us. */
async function tellFound(
  deps: CatchUpDeps,
  found: {
    readonly payment: RazorpayPayment;
    readonly paidFor: string;
    readonly personId: string | null;
    readonly next: string;
  },
): Promise<void> {
  const { payment, paidFor, personId, next } = found;
  deps.log.warn("razorpay_payment_unheard", { payment_id: payment.id });
  await deps.alertOnce({
    key: `razorpay_payment_unheard:${payment.id}`,
    message:
      `Payment ${payment.id} of ${rupees(payment.amount)} for ${paidFor} reached us only when we asked Razorpay. ` +
      `${next} Razorpay's payment messages may not be reaching us (runbook, "Razorpay's webhook is not arriving").`,
    ...(personId === null ? {} : { link: paymentsTab(personId) }),
  });
}
