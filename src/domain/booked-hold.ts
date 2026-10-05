// A hold as booking it reads one, and the payment taken for it.

import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { type Logger } from "../log.ts";
import { type AlertOnce } from "./alerts.ts";

export interface ConfirmOptions {
  /** Queues a message about the visit once its row is written (src/domain/visit-messages.ts). */
  readonly notify?: (messageId: string) => Promise<unknown>;
  /** Tells ops, once, of something they must put right by hand (src/domain/alerts.ts). */
  readonly alertOnce?: AlertOnce;
  readonly log?: Logger;
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
  state: "held" | "booked" | "released";
  expires_at: string;
  /** The grace it was made with; null for a hold made before holds kept one. */
  grace_seconds: number | null;
  confirmed_at: string | null;
  razorpay_order_id: string | null;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  move_kind: "move" | "replace" | null;
  use_credit: number;
  /** 1 for a consultation and fit in one visit, booked from the site with nothing paid (ADR 0105). */
  one_visit: number;
  /** 1 for a visit ops booked that the client pays for by the payment link ops sent, and by nothing else. */
  pay_by_link: number;
  /** Set as its refund is asked of Razorpay, and cleared only if Razorpay refuses it. */
  refunded_at: string | null;
  pincode: string | null;
  /** The pincode's city, where it is one we know. */
  city: string | null;
}

export async function bookingHoldRow(db: D1Database, holdId: string): Promise<HoldRow | null> {
  return db
    .prepare(
      `SELECT h.id, h.person_id, p.erased_at AS person_erased_at, h.type, h.tier, h.minutes, h.date, h.window_label,
              h.start_unit, h.technician_id, h.amount, h.state, h.expires_at, h.grace_seconds, h.confirmed_at,
              h.razorpay_order_id, h.appointment_id, h.moves_appointment_id, h.move_kind, h.use_credit, h.one_visit,
              h.pay_by_link, h.refunded_at, h.pincode, sp.city
       FROM slot_holds h JOIN people p ON p.id = h.person_id
       LEFT JOIN serviceable_pincodes sp ON sp.pincode = h.pincode
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<HoldRow>();
}

/** Whether the client pays money for it: not a free visit, and not one a credit covers. */
export const paidInMoney = (hold: { amount: number; use_credit: number }) => hold.amount > 0 && hold.use_credit !== 1;

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
       WHERE razorpay_order_id = ?1 AND status IN ('captured', 'partially_refunded') AND amount > refunded_amount
       ORDER BY created_at LIMIT 1`,
    )
    .bind(orderId)
    .first<CapturedPayment>();
}

/** How a try to book a hold ended. */
export type Confirmed = "booked" | "already_booked" | "being_booked" | "not_paid" | "refunded" | "lapsed";
