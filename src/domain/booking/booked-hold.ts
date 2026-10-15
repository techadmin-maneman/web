// A hold as booking it reads one, and the payment taken for it.

import type { BookingWindow } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { type Logger } from "../../log.ts";
import { type AlertOnce } from "../platform/alerts.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { PAYMENT_HELD, statusIn } from "../../config/statuses.ts";
import type { HoldState } from "./hold-stages.ts";

/** The database, Razorpay and the moment: what booking a hold, or giving one back, works with. */
export interface BookingBasis {
  readonly db: D1Database;
  readonly payments: PaymentsProvider;
  readonly now: Date;
}

/** BookingBasis, with how booking tells the client and ops, and logs. */
export interface BookingContext extends BookingBasis, ConfirmOptions {}

export interface ConfirmOptions {
  /** Queues a message about the visit once its row is written (src/domain/messages/visit-messages.ts). */
  readonly notify?: (messageId: string) => Promise<unknown>;
  /** Tells ops, once, of something they must put right by hand (src/domain/platform/alerts.ts). */
  readonly alertOnce?: AlertOnce;
  readonly log: Logger;
}

export interface HoldRow {
  id: string;
  person_id: string;
  /** When the client was erased; null while they are not. */
  person_erased_at: string | null;
  type: VisitType;
  tier: string;
  /** The length it was held for; null for a hold made before services had lengths. */
  minutes: number | null;
  date: string;
  window_label: BookingWindow;
  start_unit: number;
  technician_id: string;
  amount: number;
  state: HoldState;
  expires_at: string;
  /** The grace it was made with; null for a hold made before holds kept one. */
  grace_seconds: number | null;
  confirmed_at: string | null;
  razorpay_order_id: string | null;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  move_kind: "move" | "replace" | null;
  created_at: string;
  use_credit: number;
  /** 1 for a consultation and fit in one visit, booked from the site with nothing paid (ADR 0105). */
  one_visit: number;
  /** 1 for a visit ops booked that the client pays for by the payment link ops sent, and by nothing else. */
  pay_by_link: number;
  /** 1 for a paid visit ops booked while online payment is off: paid by UPI at the visit (ADR 0208). */
  pay_at_visit: number;
  /** Set as its refund is asked of Razorpay, and cleared only if Razorpay refuses it. */
  refunded_at: string | null;
  pincode: string | null;
  /** The pincode's city, where it is one we know. */
  city: string | null;
  /** Whether the technician it was held with is still switched on: 1, or 0 once ops switched them off. */
  technician_active: number;
}

export async function bookingHoldRow(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, p.erased_at AS person_erased_at, h.type, h.tier, h.minutes, h.date, h.window_label,
              h.start_unit, h.technician_id, h.amount, h.state, h.expires_at, h.grace_seconds, h.confirmed_at,
              h.razorpay_order_id, h.appointment_id, h.moves_appointment_id, h.move_kind, h.created_at, h.use_credit,
              h.one_visit,
              h.pay_by_link, h.pay_at_visit, h.refunded_at, h.pincode, sp.city, COALESCE(t.active, 0) AS technician_active
       FROM slot_holds h JOIN people p ON p.id = h.person_id
       LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       LEFT JOIN technicians t ON t.id = h.technician_id
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<HoldRow>();
}

/** Whether the client pays money for it before it is booked: not a free visit, one a credit covers, or one paid at the visit. */
export const paidInMoney = (hold: { amount: number; use_credit: number; pay_at_visit?: number }) =>
  hold.amount > 0 && hold.use_credit !== 1 && hold.pay_at_visit !== 1;

export interface CapturedPayment {
  razorpay_payment_id: string;
  amount: number;
  /** Razorpay's own time for the payment, not when its webhook reached us. */
  paid_at: string;
}

export async function capturedFor(db: D1Database, orderId: string | null): Promise<CapturedPayment | null> {
  if (orderId === null) return null;
  return db
    .prepare(
      `SELECT razorpay_payment_id, amount, created_at AS paid_at FROM payments
       WHERE razorpay_order_id = ?1 AND status = 'captured' ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<CapturedPayment>();
}

/**
 * What is left to give back of an order's payment: a captured one in full, or what a partial refund from Razorpay's
 * dashboard left of it. Null when nothing is.
 */
export async function refundableFor(db: D1Database, orderId: string | null): Promise<CapturedPayment | null> {
  if (orderId === null) return null;
  return db
    .prepare(
      `SELECT razorpay_payment_id, amount - refunded_amount AS amount, created_at AS paid_at FROM payments
       WHERE razorpay_order_id = ?1 AND ${statusIn("status", PAYMENT_HELD)} AND amount > refunded_amount
       ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<CapturedPayment>();
}

/** How a try to book a hold ended. */
export type Confirmed = "booked" | "already_booked" | "being_booked" | "not_paid" | "refunded" | "lapsed";

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
