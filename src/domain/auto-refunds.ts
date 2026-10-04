// Holds a booking refunded by itself (src/domain/bookings.ts): paid after the hold lapsed, or a move whose visit the
// technician had begun. The client is told on WhatsApp in the batch that lets the hold go, and ops read each on the
// client's Visits tab.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import { VISIT_TYPE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";
import { heldVisitTimes } from "./scheduling.ts";
import { DESTINATIONS, underVisitsConsent, type Composed } from "./visit-messages.ts";

/** Why a booking refunded its hold by itself. */
export const AUTO_REFUND_REASONS = ["lapsed", "not_movable"] as const;
export type AutoRefundReason = (typeof AUTO_REFUND_REASONS)[number];

/** A hold refunded by the booking itself, as the console lists it. */
export interface AutoRefund {
  readonly holdId: string;
  readonly type: VisitType;
  readonly serviceName: string;
  /** India's day the visit was to be on. */
  readonly date: string;
  /** In paise, GST included: what Razorpay took, all of which went back; null where the payment is not on record. */
  readonly amount: number | null;
  readonly reason: AutoRefundReason;
  readonly refundedAt: string;
}

interface AutoRefundRow {
  id: string;
  type: VisitType;
  service_name: string | null;
  date: string;
  amount: number | null;
  auto_refund_reason: AutoRefundReason;
  refunded_at: string;
}

/** The client's holds the booking refunded by itself, the latest refund first. */
export async function autoRefundsOf(db: D1Database, personId: string): Promise<AutoRefund[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.type, s.name AS service_name, h.date, h.auto_refund_reason, h.refunded_at,
              (SELECT p.amount FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id
                 AND p.status IN ('captured', 'refunded', 'partially_refunded') ORDER BY p.created_at LIMIT 1) AS amount
       FROM slot_holds h LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
       WHERE h.person_id = ?1 AND h.auto_refund_reason IS NOT NULL AND h.refunded_at IS NOT NULL
       ORDER BY h.refunded_at DESC`,
    )
    .bind(personId)
    .all<AutoRefundRow>();
  return results.map((row) => ({
    holdId: row.id,
    type: row.type,
    serviceName: row.service_name ?? VISIT_TYPE_NAMES[row.type],
    date: row.date,
    amount: row.amount,
    reason: row.auto_refund_reason,
    refundedAt: row.refunded_at,
  }));
}

/** The client's message that a booking was not made and its money is on its way back, to go in the refund's batch. */
export function refundedMessage(
  db: D1Database,
  input: { readonly personId: string; readonly holdId: string; readonly now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, 'booking_refunded', 'slot_hold', ?4, 'queued', ?2)`,
    )
    .bind(id, input.now.toISOString(), input.personId, input.holdId);
  return { id, statement };
}

/** The client's message, by whether the booking moved a visit, which still stands, and whether anything was paid. */
const REFUNDED_TEMPLATES = {
  booking: { paid: "booking_refunded_v1", unpaid: "booking_not_made_v1" },
  move: { paid: "move_refunded_v1", unpaid: "move_not_made_v1" },
} as const;

/**
 * What the client is told when a booking is given back: the visit, and what comes back to them. A booking that moved
 * a visit says the move was not made, since the visit it moved still stands. A refund goes whatever their consent;
 * that nothing was booked goes only with their consent to WhatsApp about their visits.
 */
export async function composeBookingRefunded(db: D1Database, holdId: string, personId: string): Promise<Composed> {
  return underVisitsConsent(db, personId, await composeGivenBack(db, holdId, personId));
}

async function composeGivenBack(db: D1Database, holdId: string, personId: string): Promise<Composed> {
  const hold = await db
    .prepare(
      `SELECT h.type, h.minutes, h.date, h.start_unit, h.move_kind, p.name,
              (SELECT pay.amount FROM payments pay WHERE pay.razorpay_order_id = h.razorpay_order_id
                 AND pay.status IN ('captured', 'refunded', 'partially_refunded') ORDER BY pay.created_at LIMIT 1) AS paid,
              (SELECT pay.method FROM payments pay WHERE pay.razorpay_order_id = h.razorpay_order_id
                 ORDER BY pay.created_at LIMIT 1) AS method
       FROM slot_holds h JOIN people p ON p.id = h.person_id
       WHERE h.id = ?1 AND h.person_id = ?2 AND h.state = 'released'`,
    )
    .bind(holdId, personId)
    .first<{
      type: VisitType;
      minutes: number | null;
      date: string;
      start_unit: number;
      move_kind: "move" | "replace" | null;
      name: string;
      paid: number | null;
      method: string | null;
    }>();
  if (hold === null) return { skip: "the booking is not given back" };
  const start = (await heldVisitTimes(db, hold)).start;
  const params = [
    firstNameOf(hold.name),
    VISIT_TYPE_NAMES[hold.type].toLowerCase(),
    shortDate(indiaDate(start)),
    "",
    "",
    hold.paid === null ? "" : rupees(hold.paid),
    "",
    DESTINATIONS[hold.method ?? ""] ?? "payment method",
  ];
  const templates = REFUNDED_TEMPLATES[hold.move_kind === null ? "booking" : "move"];
  return { template: hold.paid === null ? templates.unpaid : templates.paid, params };
}
