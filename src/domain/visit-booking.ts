// Booking a visit from the console: every kind, for a client ops are talking to, in a window and with a technician
// found by the same availability and clash check the app books by (src/domain/scheduling.ts). What is paid at booking
// decides what follows (src/policy/pay-by-link.ts): a visit nothing is paid for, free, on a credit, or a consultation
// and fit in one visit, is confirmed and booked at once; a paid visit holds its slot while a Razorpay payment link is
// open, and is booked once the link is paid (src/routes/hooks/razorpay.ts).
//
// Ops book within the days a client may book, from tomorrow to the horizon ops set, and a consultation or a first fit
// only while the client has none still to come. A discount code ops enter comes off the price before GST, as the
// client's own would at the pay step; on a one visit it waits for the payment link, as the site's does.

import { shortDate } from "@maneman/web-kit/dates";
import { HOLD_SECONDS, type BookingWindow } from "../config/scheduling.ts";
import { onAllowlist, type MessagingSettings } from "../config/settings.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { failureReason, type Logger } from "../log.ts";
import { amountOff, discounted } from "../policy/discount-codes.ts";
import { LATE_FEES, type SoldTerms } from "../policy/moving-a-visit.ts";
import { lastBookableDay } from "../policy/next-visit.ts";
import { ONE_VISIT_TERMS, ONE_VISIT_WINDOWS } from "../policy/one-visit.ts";
import { linkOpenUntil } from "../policy/pay-by-link.ts";
import { takesCredit } from "../policy/referral-reward.ts";
import { windowTimesOf } from "../policy/slot-times.ts";
import type { MadeLink, PaymentsProvider } from "../providers/payments/index.ts";
import type { RazorpayPayment } from "../providers/payments/razorpay.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { spendableCredits } from "./credits.ts";
import { checkForOneVisit, codeOnHold } from "./discount-code-holds.ts";
import { checkDiscountCode, useStatement } from "./discount-code-uses.ts";
import { termsOf } from "./discount-codes.ts";
import { typedOnWaitingRequest } from "./requested-codes.ts";
import type { OpsInputs } from "./ops-settings.ts";
import { recordPayment, referenceHold } from "./payments.ts";
import { lateFeeOn, type Price } from "./price-book.ts";
import { currentAddress } from "./profile.ts";
import { graceEnds, holdSlot, liveVisitOf, ONE_AT_A_TIME, type Hold } from "./scheduling.ts";
import { bookableService, offeredProducts, type PricedService } from "./services.ts";
import { loadSlotSchedule } from "./slot-times.ts";
import { termsInForce } from "./visit-changes.ts";

/** What ops ask for. */
export interface VisitAsked {
  readonly personId: string;
  readonly kind: VisitType;
  /** The service within the kind; left out, the kind's standard one. A first fit names the hair system. */
  readonly tier: string | undefined;
  /** The technician ops chose; left out, whoever is free, the client's regular technician first. */
  readonly technicianId: string | undefined;
  readonly date: string;
  readonly window: BookingWindow;
  /** A consultation and fit in one visit: a first fit, with nothing paid until the client is fitted. */
  readonly oneVisit: boolean;
  readonly code: string | undefined;
}

export const PAYS = ["nothing", "credit", "link"] as const;
/** How a visit ops book is paid for: nothing at booking, by a credit, or by a payment link. */
export type Pays = (typeof PAYS)[number];

/** A discount code that applies to the booking: the code, and what it takes off, unknown on a one visit until the link. */
interface AppliedCode {
  readonly id: string;
  readonly amountOff: number | null;
  /** When the client typed it on /book, for the one visit asked for there; null for a code judged now. */
  readonly typedAt: Date | null;
}

/** What a visit is sold as, before its slot is held. */
export interface Sale {
  readonly service: PricedService;
  /** What the hold is sold for: the service's price less the code, or nothing on a one visit. */
  readonly price: Price;
  readonly lateFee: Price | null;
  readonly terms: SoldTerms;
  readonly pays: Pays;
  readonly code: AppliedCode | null;
}

/** Why a booking was refused, as the route answers it. */
export type Refusal =
  | { readonly status: 400; readonly code: "invalid_request"; readonly fields: readonly string[] }
  | { readonly status: 404; readonly code: "not_found" }
  | { readonly status: 409; readonly code: "already_booked" }
  | { readonly status: 422; readonly code: "not_bookable" | "no_product" | "code_not_applicable" };

type Refused = { readonly ok: false; readonly refusal: Refusal };

const refused = (refusal: Refusal): Refused => ({ ok: false, refusal });

async function isClient(db: D1Database, personId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM people WHERE id = ?1 AND erased_at IS NULL").bind(personId).first();
  return row !== null;
}

/** The days ops may book on: from tomorrow to the horizon ops set. */
export function bookableRange(now: Date, inputs: Pick<OpsInputs, "nextVisitDays">): { opens: string; last: string } {
  const tomorrow = addDays(indiaDate(now), 1);
  return { opens: tomorrow, last: lastBookableDay(tomorrow, inputs.nextVisitDays) };
}

/**
 * A payment link ops sent for a consultation or first fit of the client's that can still be paid: until its hold's
 * grace is over, since Razorpay may still be taking the payment.
 */
async function linkStillOpen(db: D1Database, personId: string, kind: VisitType, now: Date): Promise<boolean> {
  if (!ONE_AT_A_TIME.includes(kind)) return false;
  const open = await db
    .prepare(
      `SELECT 1 FROM slot_holds
       WHERE person_id = ?1 AND type = ?2 AND pay_by_link = 1 AND state = 'held' AND ${graceEnds("slot_holds")} > ?3
       LIMIT 1`,
    )
    .bind(personId, kind, now.toISOString())
    .first();
  return open !== null;
}

/** A consultation or a first fit still to come, or a link open for one, which a second of its kind would double. */
async function alreadyToCome(db: D1Database, asked: VisitAsked, now: Date): Promise<boolean> {
  if ((await liveVisitOf(db, asked.personId, asked.kind)) !== null) return true;
  if (await linkStillOpen(db, asked.personId, asked.kind, now)) return true;
  return asked.oneVisit && (await liveVisitOf(db, asked.personId, "consultation")) !== null;
}

/** Why no service was found: no hair system on sale that day, for a first fit; else nothing that is booked so. */
async function noServiceRefusal(db: D1Database, asked: VisitAsked): Promise<"no_product" | "not_bookable"> {
  const noProduct = asked.kind === "first_fit" && (await offeredProducts(db, asked.date)).length === 0;
  return noProduct ? "no_product" : "not_bookable";
}

/** Whether a credit pays for it: a service visit, while the client has one to spend. */
export async function paysByCredit(db: D1Database, personId: string, kind: VisitType, now: Date): Promise<boolean> {
  if (!takesCredit(kind, null)) return false;
  return (await spendableCredits(db, personId, now)).visits > 0;
}

/**
 * The code ops typed, if it applies to this booking for this client; null for none typed, false for one refused. The
 * code the client typed on /book for the one visit ops book from their request is honoured as it stood when typed.
 */
async function codeFor(
  db: D1Database,
  asked: VisitAsked,
  booking: { readonly onCredit: boolean; readonly priceExGst: number },
  now: Date,
): Promise<AppliedCode | null | false> {
  if (asked.code === undefined) return null;
  if (asked.oneVisit) {
    const typedAt = await typedOnWaitingRequest(db, asked.personId, asked.code);
    const checked = await checkForOneVisit(db, asked.code, asked.personId, now, typedAt ?? now);
    return checked.ok ? { id: checked.codeId, amountOff: null, typedAt } : false;
  }
  const codeBooking = { type: asked.kind, onCredit: booking.onCredit, moves: false };
  const checked = await checkDiscountCode(db, asked.code, codeBooking, asked.personId, now);
  if (!checked.ok) return false;
  return { id: checked.code.id, amountOff: amountOff(termsOf(checked.code), booking.priceExGst), typedAt: null };
}

/** Nothing paid at booking, with the service's GST kept for the record. */
const nothingPaid = (price: Price): Price => ({ amount: 0, amount_ex_gst: 0, gst_percent: price.gst_percent });

/** How it is paid: nothing at booking for a one visit or a free one, a credit where one pays, else a link. */
export function paysFor(oneVisit: boolean, onCredit: boolean, price: Price): Pays {
  if (oneVisit || price.amount === 0) return "nothing";
  return onCredit ? "credit" : "link";
}

/**
 * What the visit is sold as, or why it cannot be booked: the client, the kind, the day and the service checked, then
 * the credit, the code and the terms in force.
 */
export async function saleFor(
  db: D1Database,
  asked: VisitAsked,
  inputs: OpsInputs,
  now: Date,
): Promise<{ ok: true; sale: Sale } | Refused> {
  if (!(await isClient(db, asked.personId))) return refused({ status: 404, code: "not_found" });
  if (asked.oneVisit && asked.kind !== "first_fit") {
    return refused({ status: 400, code: "invalid_request", fields: ["one_visit"] });
  }
  if (asked.oneVisit && !(ONE_VISIT_WINDOWS as readonly BookingWindow[]).includes(asked.window)) {
    return refused({ status: 400, code: "invalid_request", fields: ["window"] });
  }
  const { opens, last } = bookableRange(now, inputs);
  if (asked.date < opens || asked.date > last) return refused({ status: 422, code: "not_bookable" });
  if (await alreadyToCome(db, asked, now)) return refused({ status: 409, code: "already_booked" });

  const service = await bookableService(db, asked.kind, asked.tier, asked.date);
  if (service === null) return refused({ status: 422, code: await noServiceRefusal(db, asked) });
  const onCredit = !asked.oneVisit && (await paysByCredit(db, asked.personId, asked.kind, now));
  const code = await codeFor(db, asked, { onCredit, priceExGst: service.price.amount_ex_gst }, now);
  if (code === false) return refused({ status: 422, code: "code_not_applicable" });

  const price = asked.oneVisit ? nothingPaid(service.price) : discounted(service.price, code?.amountOff ?? 0);
  const lateFeeItem = LATE_FEES[asked.kind];
  const lateFee = asked.oneVisit || lateFeeItem === undefined ? null : await lateFeeOn(db, lateFeeItem, asked.date);
  const terms = asked.oneVisit ? ONE_VISIT_TERMS : termsInForce(inputs, asked.kind);
  return { ok: true, sale: { service, price, lateFee, terms, pays: paysFor(asked.oneVisit, onCredit, price), code } };
}

/** When the window starts on its day, by the times in force then: the earliest the visit can start. */
async function windowStart(db: D1Database, date: string, window: BookingWindow): Promise<Date> {
  const times = windowTimesOf((await loadSlotSchedule(db)).on(date));
  return indiaInstant(date, times[window].start);
}

/** When a paid visit's link closes and its slot is let go; null for a visit too close for a link. */
export async function linkClosesAt(db: D1Database, asked: VisitAsked, now: Date): Promise<Date | null> {
  return linkOpenUntil(now, await windowStart(db, asked.date, asked.window));
}

/** Who booked it, and the request, for the audit entry written with the hold. */
export interface BookedBy {
  readonly actor: AuditActor;
  readonly requestId: string;
}

/** A hold being made for a sale, and who made it. */
interface Booked {
  readonly asked: VisitAsked;
  readonly sale: Sale;
  readonly holdId: string;
  readonly by: BookedBy;
}

/** Ops' entry for the booking: the hold and what it is for, and the code where one was entered. */
function bookingAudit(db: D1Database, booked: Booked, now: Date): D1PreparedStatement {
  const { asked, sale, holdId, by } = booked;
  const detail: Record<string, string> = {
    hold_id: holdId,
    kind: asked.kind,
    tier: sale.service.tier,
    date: asked.date,
    window: asked.window,
    pays: sale.pays,
  };
  if (asked.code !== undefined) detail.code = asked.code.toUpperCase();
  const typedAt = sale.code?.typedAt ?? null;
  if (typedAt !== null) detail.code_typed_at = typedAt.toISOString();
  const entry = {
    surface: "ops",
    actor: by.actor,
    action: "visit.book",
    subject: { kind: "person", id: asked.personId },
    requestId: by.requestId,
    detail,
  } as const;
  return auditStatement(db, entry, now);
}

/** The code's use on the new hold, written only while the code still has a use left for this client. */
function codeUse(db: D1Database, asked: VisitAsked, code: AppliedCode, holdId: string, by: BookedBy, now: Date) {
  const use = {
    id: crypto.randomUUID(),
    codeId: code.id,
    personId: asked.personId,
    holdId,
    visitId: null,
    amountOff: code.amountOff,
    by: { kind: "ops", actor: by.actor },
    typedAt: code.typedAt ?? now,
  } as const;
  return useStatement(db, use, "new_hold", now);
}

/**
 * Holds the slot for the sale, with ops' entry and the code's use in the same batch: a link's until the link closes,
 * any other's for the usual ten minutes, since it is confirmed straight after. Null when nobody chosen is free.
 */
export async function holdForSale(
  db: D1Database,
  asked: VisitAsked,
  sale: Sale,
  hold: { readonly closesAt: Date | null; readonly graceSeconds: number; readonly by: BookedBy },
  now: Date,
): Promise<Hold | null> {
  const address = await currentAddress(db, asked.personId);
  const holdSeconds =
    hold.closesAt === null ? HOLD_SECONDS : Math.floor((hold.closesAt.getTime() - now.getTime()) / 1000);
  return holdSlot(
    db,
    {
      personId: asked.personId,
      service: { type: asked.kind, tier: sale.service.tier, minutes: sale.service.minutes },
      date: asked.date,
      window: asked.window,
      price: sale.price,
      lateFee: sale.lateFee,
      terms: sale.terms,
      pincode: address?.pincode ?? null,
      useCredit: sale.pays === "credit",
      oneVisit: asked.oneVisit,
      from: "ops",
      payByLink: sale.pays === "link",
      ...(asked.technicianId === undefined ? {} : { technicianId: asked.technicianId }),
      afterHold: (holdId) => [
        ...(sale.code === null ? [] : [codeUse(db, asked, sale.code, holdId, hold.by, now)]),
        bookingAudit(db, { asked, sale, holdId, by: hold.by }, now),
      ],
    },
    now,
    holdSeconds,
    hold.graceSeconds,
  );
}

/** Whether the code ops typed stands on the hold: another booking may have taken its last use a moment before. */
export async function codeStands(db: D1Database, asked: VisitAsked, holdId: string): Promise<boolean> {
  if (asked.code === undefined) return true;
  return (await codeOnHold(db, holdId)) !== null;
}

/** What the client reads on Razorpay's page: "Mane Man Natural · Fri 25 Sep, morning", as Checkout writes it. */
const linkDescription = (sale: Sale, asked: VisitAsked) =>
  `${sale.service.name} · ${shortDate(asked.date)}, ${asked.window}`;

/** The link Razorpay made under the hold, if a try whose answer never came made one; null where none or unknown. */
async function linkMadeBefore(payments: PaymentsProvider, reference: string): Promise<MadeLink | null> {
  try {
    return await payments.findPaymentLink(reference);
  } catch {
    return null;
  }
}

/** The hold's link's reference, "MM-2026-0841", which its payment then takes: given it now, or kept from a try before. */
async function holdReference(db: D1Database, holdId: string, now: Date): Promise<string> {
  const [, kept] = await db.batch<{ reference: string | null }>([
    referenceHold(db, holdId, now),
    db.prepare("SELECT reference FROM slot_holds WHERE id = ?1").bind(holdId),
  ]);
  return kept?.results[0]?.reference ?? holdId;
}

/**
 * Asks Razorpay for the hold's payment link, closing as the hold does, and keeps it on the hold. Razorpay texts it to
 * a client whose number is on the allowlist, which in production is every client. Null when Razorpay made none that
 * can be found, and the hold is then the caller's to let go.
 */
export async function sendHoldLink(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly log: Logger; readonly messagingSettings: MessagingSettings },
  held: { readonly hold: Hold; readonly asked: VisitAsked; readonly sale: Sale; readonly closesAt: Date },
  now: Date,
): Promise<MadeLink | null> {
  const { hold, asked, sale, closesAt } = held;
  const client = await db
    .prepare("SELECT name, mobile_e164 FROM people WHERE id = ?1")
    .bind(asked.personId)
    .first<{ name: string; mobile_e164: string }>();
  const reference = await holdReference(db, hold.id, now);
  const contact = client?.mobile_e164 ?? "";
  const notify = onAllowlist(deps.messagingSettings, contact);
  let made: MadeLink | null;
  try {
    made = await deps.payments.createPaymentLink({
      amount: sale.price.amount,
      reference,
      description: linkDescription(sale, asked),
      customer: { name: client?.name ?? "", contact },
      notes: { hold_id: hold.id, person_id: asked.personId },
      closesAt,
      notify,
    });
  } catch (error) {
    deps.log.warn("hold_link_failed", { hold_id: hold.id, reason: failureReason(error) });
    made = await linkMadeBefore(deps.payments, reference);
  }
  if (made === null) return null;
  if (!notify) deps.log.info("payment_link_not_texted", { hold_id: hold.id });
  await db
    .prepare("UPDATE slot_holds SET payment_link_id = ?2, payment_link_url = ?3, updated_at = ?4 WHERE id = ?1")
    .bind(hold.id, made.id, made.shortUrl, now.toISOString())
    .run();
  return made;
}

/** The visit a hold became, once booked; null while it is not. */
export async function visitOfHold(db: D1Database, holdId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT appointment_id FROM slot_holds WHERE id = ?1 AND state = 'booked'")
    .bind(holdId)
    .first<{ appointment_id: string | null }>();
  return row?.appointment_id ?? null;
}

/** A hold ops sent a payment link for, and whose it is. */
export interface LinkHold {
  readonly id: string;
  readonly personId: string;
}

/**
 * The hold a paid link was for: by the link's ID, or by its reference, which is the hold's, or the hold's own ID on a
 * link made before holds had one. Null for no hold of ours.
 */
export async function holdOfLink(
  db: D1Database,
  link: { readonly razorpayLinkId: string; readonly reference: string | null },
): Promise<LinkHold | null> {
  return db
    .prepare(
      `SELECT id, person_id AS personId FROM slot_holds
       WHERE pay_by_link = 1 AND (payment_link_id = ?1 OR reference = ?2 OR id = ?2) LIMIT 1`,
    )
    .bind(link.razorpayLinkId, link.reference)
    .first<LinkHold>();
}

/**
 * A hold's link paid: the order Razorpay made for the link becomes the hold's, then the payment is recorded as made
 * for it, which confirms the hold from Razorpay's own time, as a payment at Checkout does (src/domain/payments.ts).
 * Whether it came in time, and so is booked or refunded, is the booking's to decide.
 */
export async function recordHoldLinkPaid(
  db: D1Database,
  paid: { readonly hold: LinkHold; readonly payment: RazorpayPayment; readonly orderId: string },
  hashSalt: string,
  now: Date,
): Promise<void> {
  const { hold, payment, orderId } = paid;
  await db
    .prepare(
      "UPDATE slot_holds SET razorpay_order_id = ?2, updated_at = ?3 WHERE id = ?1 AND razorpay_order_id IS NULL",
    )
    .bind(hold.id, orderId, now.toISOString())
    .run();
  const notes = { hold_id: hold.id, person_id: hold.personId };
  await recordPayment(db, { ...payment, order_id: orderId, notes }, "captured", hashSalt, now);
}
