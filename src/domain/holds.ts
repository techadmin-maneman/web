// A client's hold, as the app shows it (docs/decisions/0045-self-serve-booking.md): the window held for ten
// minutes while they pay, the service it is for, what it costs, and what became of it. Letting one go, and what
// Checkout is opened with. A hold is made by holdSlot (src/domain/scheduling.ts) and booked by startBooking
// (src/domain/bookings.ts).

import { withGst } from "../config/gst.ts";
import { WINDOW_TIMES, type BookingWindow } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaInstant } from "../lib/india-time.ts";
import { FREE_CHANGE_NOTICE_HOURS, freeUntil, LATE_FEES } from "../policy/moving-a-visit.ts";
import { creditBalance } from "./credits.ts";
import { priceOf, type Price } from "./price-book.ts";
import { heldMinutes, visitTimes } from "./scheduling.ts";

interface HoldRow {
  id: string;
  type: VisitType;
  tier: string;
  minutes: number | null;
  /** The service's name as it is now; null only where no service is the hold's kind and tier. */
  service_name: string | null;
  date: string;
  window_label: BookingWindow;
  start_unit: number;
  amount: number;
  amount_ex_gst: number;
  gst_percent: number;
  state: "held" | "booked" | "released";
  expires_at: string;
  confirmed_at: string | null;
  late_fee_ex_gst: number | null;
  late_fee_gst_percent: number | null;
  /** The notice it was sold under; null for a hold made before holds kept one. */
  change_notice_hours: number | null;
  technician_name: string;
  technician_initials: string;
  appointment_id: string | null;
  moves_appointment_id: string | null;
  use_credit: number;
  person_id: string;
  paid: number;
}

const HOLD_QUERY = `SELECT h.id, h.type, h.tier, h.minutes, s.name AS service_name, h.date, h.window_label, h.start_unit,
    h.amount, h.amount_ex_gst, h.gst_percent, h.state, h.expires_at, h.confirmed_at, h.late_fee_ex_gst,
    h.late_fee_gst_percent, h.change_notice_hours, t.name AS technician_name, t.initials AS technician_initials, h.appointment_id,
    h.moves_appointment_id, h.use_credit, h.person_id,
    EXISTS (SELECT 1 FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id AND p.status = 'captured') AS paid
  FROM slot_holds h JOIN technicians t ON t.id = h.technician_id
  LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
  WHERE h.id = ?1 AND h.person_id = ?2`;

/** The late fee the hold was made under; for a hold made before it kept one, the price book's for its day. */
async function lateFeeOf(db: D1Database, row: HoldRow): Promise<Price | null> {
  const item = LATE_FEES[row.type];
  if (item === undefined) return null;
  if (row.late_fee_ex_gst === null || row.late_fee_gst_percent === null) return priceOf(db, item, row.date);
  return {
    amount_ex_gst: row.late_fee_ex_gst,
    amount: withGst(row.late_fee_ex_gst, row.late_fee_gst_percent),
    gst_percent: row.late_fee_gst_percent,
  };
}

/** A hold not paid for and past its ten minutes: the client may no longer pay for it. */
const hasLapsed = (row: HoldRow, now: Date) =>
  row.state === "held" && row.confirmed_at === null && row.expires_at <= now.toISOString();

async function holdOf(db: D1Database, row: HoldRow, now: Date) {
  const minutes = heldMinutes(row);
  const { start, end } = visitTimes(row.date, row.start_unit, minutes);
  const windowStarts = indiaInstant(row.date, WINDOW_TIMES[row.window_label].start);
  const noticeHours = row.change_notice_hours ?? FREE_CHANGE_NOTICE_HOURS;
  return {
    id: row.id,
    type: row.type,
    service: { tier: row.tier, name: row.service_name ?? FSM_SERVICE_NAMES[row.type], minutes },
    date: row.date,
    window: row.window_label,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    technician: { name: row.technician_name, initials: row.technician_initials },
    price: { amount_ex_gst: row.amount_ex_gst, amount: row.amount, gst_percent: row.gst_percent },
    late_fee: await lateFeeOf(db, row),
    free_until: freeUntil(windowStarts, noticeHours).toISOString(),
    change_notice_hours: noticeHours,
    expires_at: row.expires_at,
    state: hasLapsed(row, now) ? ("expired" as const) : row.state,
    paid: row.paid === 1,
    visit_id: row.appointment_id,
    moves_visit_id: row.moves_appointment_id,
    credit:
      row.use_credit === 1
        ? {
            remaining: Math.max(
              0,
              (await creditBalance(db, row.person_id, now)).visits - (row.state === "held" ? 1 : 0),
            ),
          }
        : null,
  };
}

/** One of the client's holds as the app shows it; null when there is no such hold of theirs. */
export async function clientHold(db: D1Database, holdId: string, personId: string, now: Date) {
  const row = await db.prepare(HOLD_QUERY).bind(holdId, personId).first<HoldRow>();
  return row === null ? null : holdOf(db, row, now);
}

/**
 * Lets a client's hold go, with the time it held. Once paid for, or booked free, it is on its way to FSM, and only
 * a booking or a refund ends it (docs/decisions/0068-a-paid-hold-is-kept.md).
 */
export async function releaseHold(db: D1Database, hold: { holdId: string; personId: string; now: Date }) {
  const mine = "SELECT id FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND state = 'held' AND confirmed_at IS NULL";
  await db.batch([
    db.prepare(`DELETE FROM slot_claims WHERE hold_id IN (${mine})`).bind(hold.holdId, hold.personId),
    db
      .prepare(`UPDATE slot_holds SET state = 'released', updated_at = ?3 WHERE id IN (${mine})`)
      .bind(hold.holdId, hold.personId, hold.now.toISOString()),
  ]);
}

/** What Checkout names a hold's payment with, and prefills. */
export interface CheckoutHold {
  readonly type: VisitType;
  /** The hold's service, by its name as it is now; null only where no service is the hold's kind and tier. */
  readonly service_name: string | null;
  readonly amount: number;
  readonly date: string;
  readonly move_kind: "move" | "replace" | null;
  readonly name: string;
  readonly mobile_e164: string;
}

export function checkoutHold(db: D1Database, holdId: string): Promise<CheckoutHold | null> {
  return db
    .prepare(
      `SELECT h.type, s.name AS service_name, h.amount, h.date, h.move_kind, p.name, p.mobile_e164
       FROM slot_holds h JOIN people p ON p.id = h.person_id
       LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
       WHERE h.id = ?1`,
    )
    .bind(holdId)
    .first<CheckoutHold>();
}
