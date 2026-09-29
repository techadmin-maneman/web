// A booking FSM refused five times running, held for ops rather than refunded
// (docs/decisions/0095-a-booking-fsm-refuses-is-held.md; the rule is src/policy/held-bookings.ts).
//
// Nothing is given back. The hold stays held and confirmed, so the clash check
// still counts its time and nobody else is sold it (ADR 0068), and its payment
// stays as Razorpay took it. fsm_held_at says it waits for ops, who are told
// once. The cron puts it back on the queue every hour for 24 hours from then,
// one try at a time; a try that books it books it as the first would have, and
// the client is told as they would have been. After that it waits for ops, who
// try FSM again, link a visit they booked in FSM by hand, or refund it, from
// the client's page (src/routes/ops-bookings.ts). The Tasks board lists it
// until one of them is done.

import { shortDate } from "@maneman/web-kit/dates";
import { rupees } from "@maneman/web-kit/money";
import type { BookingWindow } from "../config/scheduling.ts";
import { FSM_SERVICE_NAMES, type VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { firstNameOf } from "../lib/names.ts";
import type { Logger } from "../log.ts";
import { dueAnotherTry, FSM_RETRY, retriesEnd, type FsmRetry } from "../policy/held-bookings.ts";
import type { FsmSyncMessage } from "../queues/fsm-sync.ts";
import { consentGiven } from "./messages.ts";
import { heldMinutes, visitTimes } from "./scheduling.ts";
import { DESTINATIONS, NO_VISITS_CONSENT, type Composed } from "./visit-messages.ts";
import { HOUR_MS } from "../lib/durations.ts";

/** The alert a booking held for ops raises, once; closed when it is booked or given back. */
export const heldAlertKey = (holdId: string) => `booking_held:${holdId}`;

/** Whether FSM's refusals have already held the booking for ops, so a failed try is the cron's to repeat. */
export async function isHeldForFsm(db: D1Database, holdId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM slot_holds WHERE id = ?1 AND state = 'held' AND fsm_held_at IS NOT NULL")
    .bind(holdId)
    .first();
  return row !== null;
}

/** A booking FSM has refused, and whether this refusal is the one that held it. */
export interface Refused {
  readonly personId: string;
  readonly newlyHeld: boolean;
}

/**
 * Keeps FSM's latest refusal on the booking and holds it for ops, if it is not held already. Its first hourly try
 * comes an hour after this. Null when the hold is no longer held: another try booked it, or it was given back.
 */
export async function holdForFsm(db: D1Database, holdId: string, now: Date, reason: string): Promise<Refused | null> {
  const at = now.toISOString();
  const held = await db
    .prepare(
      `UPDATE slot_holds SET fsm_held_at = ?2, queued_at = ?2, fsm_refusal = ?3, updated_at = ?2
       WHERE id = ?1 AND state = 'held' AND fsm_held_at IS NULL RETURNING person_id`,
    )
    .bind(holdId, at, reason)
    .first<{ person_id: string }>();
  if (held !== null) return { personId: held.person_id, newlyHeld: true };
  const again = await db
    .prepare(
      "UPDATE slot_holds SET fsm_refusal = ?2, updated_at = ?3 WHERE id = ?1 AND state = 'held' RETURNING person_id",
    )
    .bind(holdId, reason, at)
    .first<{ person_id: string }>();
  return again === null ? null : { personId: again.person_id, newlyHeld: false };
}

/** "every hour", "every 3 hours". */
const everyText = (hours: number) => (hours === 1 ? "every hour" : `every ${String(hours)} hours`);

/** What ops are told, once, when a booking is held: why, that nothing was given back, and what happens next. */
export function heldAlert(holdId: string, attempts: number, reason: string, retry: FsmRetry): string {
  return (
    `Booking ${holdId} could not be written to FSM after ${String(attempts)} attempts: ${reason}. ` +
    "Nothing is refunded: its slot, and its payment if it was paid, are kept. " +
    `It is tried again ${everyText(retry.every)} for ${String(retry.for)} hours, then waits for you. ` +
    "Try it again, link the visit you book in FSM, or refund it, from the client's Visits tab."
  );
}

/** The most held bookings one cron run puts back on the queue: a statement and two calls each, well inside 1,000. */
const RETRIES_PER_PASS = 20;

interface WaitingRow {
  id: string;
  type: VisitType;
  minutes: number | null;
  date: string;
  start_unit: number;
  fsm_held_at: string;
  queued_at: string;
}

/**
 * Puts each held booking due another try back on the queue (src/policy/held-bookings.ts): tried last an interval
 * ago, inside its retries, its visit still to come. One whose visit has begun is not tried, and its try is counted
 * as spent, so the next is an interval on and the pass moves on to the others. Returns how many went back.
 */
export async function retryHeldBookings(
  db: D1Database,
  input: { readonly queue: Queue; readonly log: Logger },
  now: Date,
  retry: FsmRetry = FSM_RETRY,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, type, minutes, date, start_unit, fsm_held_at, queued_at FROM slot_holds
       WHERE state = 'held' AND confirmed_at IS NOT NULL AND fsm_held_at IS NOT NULL
         AND fsm_held_at > ?1 AND queued_at <= ?2
       ORDER BY queued_at LIMIT ?3`,
    )
    .bind(
      new Date(now.getTime() - retry.for * HOUR_MS).toISOString(),
      new Date(now.getTime() - retry.every * HOUR_MS).toISOString(),
      RETRIES_PER_PASS,
    )
    .all<WaitingRow>();
  let retried = 0;
  for (const hold of results) {
    const booking = {
      heldAt: new Date(hold.fsm_held_at),
      lastTried: new Date(hold.queued_at),
      visitStart: visitTimes(hold.date, hold.start_unit, heldMinutes(hold)).start,
    };
    const due = dueAnotherTry(booking, now, retry);
    if (due) {
      try {
        await input.queue.send({ hold_id: hold.id, request_id: "held-bookings" } satisfies FsmSyncMessage);
      } catch (error) {
        input.log.warn("held_booking_requeue_failed", { hold_id: hold.id, error });
        continue;
      }
    }
    await db.prepare("UPDATE slot_holds SET queued_at = ?2 WHERE id = ?1").bind(hold.id, now.toISOString()).run();
    if (due) retried += 1;
  }
  return retried;
}

/** A booking held for ops, as the client's page shows it with its actions. */
export interface HeldBooking {
  readonly id: string;
  readonly type: VisitType;
  readonly serviceName: string;
  readonly startsAt: string;
  readonly window: BookingWindow;
  /** In paise, GST included: what Razorpay took for it; 0 when a credit covers it or it is free. */
  readonly paid: number;
  readonly usesCredit: boolean;
  /** It moves a visit already booked, so trying FSM again is how it is booked, and there is no new visit to link. */
  readonly movesVisit: boolean;
  readonly heldAt: string;
  readonly refusal: string | null;
  /** When the hourly tries end, or ended. */
  readonly retriesEnd: string;
  /** Whether the cron still tries it: inside its retries, and its visit still to come. */
  readonly retrying: boolean;
}

interface HeldRow {
  id: string;
  type: VisitType;
  tier: string;
  minutes: number | null;
  service_name: string | null;
  date: string;
  window_label: BookingWindow;
  start_unit: number;
  use_credit: number;
  move_kind: "move" | "replace" | null;
  fsm_held_at: string;
  fsm_refusal: string | null;
  paid: number | null;
}

/** The client's bookings held for ops, the soonest visit first. */
export async function heldBookingsOf(
  db: D1Database,
  personId: string,
  now: Date,
  retry: FsmRetry = FSM_RETRY,
): Promise<HeldBooking[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.type, h.tier, h.minutes, s.name AS service_name, h.date, h.window_label, h.start_unit,
              h.use_credit, h.move_kind, h.fsm_held_at, h.fsm_refusal,
              (SELECT p.amount FROM payments p WHERE p.razorpay_order_id = h.razorpay_order_id AND p.status = 'captured'
                ORDER BY p.created_at LIMIT 1) AS paid
       FROM slot_holds h LEFT JOIN services s ON s.kind = h.type AND s.tier = h.tier
       WHERE h.person_id = ?1 AND h.state = 'held' AND h.confirmed_at IS NOT NULL AND h.fsm_held_at IS NOT NULL
       ORDER BY h.date, h.start_unit`,
    )
    .bind(personId)
    .all<HeldRow>();
  return results.map((row) => {
    const heldAt = new Date(row.fsm_held_at);
    const start = visitTimes(row.date, row.start_unit, heldMinutes(row)).start;
    const ends = retriesEnd(heldAt, retry);
    return {
      id: row.id,
      type: row.type,
      serviceName: row.service_name ?? FSM_SERVICE_NAMES[row.type],
      startsAt: start.toISOString(),
      window: row.window_label,
      paid: row.paid ?? 0,
      usesCredit: row.use_credit === 1,
      movesVisit: row.move_kind === "move",
      heldAt: row.fsm_held_at,
      refusal: row.fsm_refusal,
      retriesEnd: ends.toISOString(),
      retrying: now < ends && now < start,
    };
  });
}

/** A held booking still waiting for ops, as the routes act on it; null once it is booked or given back. */
export async function heldBookingById(
  db: D1Database,
  holdId: string,
): Promise<{ personId: string; startsAt: Date } | null> {
  const row = await db
    .prepare(
      `SELECT person_id, type, minutes, date, start_unit FROM slot_holds
       WHERE id = ?1 AND state = 'held' AND confirmed_at IS NOT NULL AND fsm_held_at IS NOT NULL`,
    )
    .bind(holdId)
    .first<{ person_id: string; type: VisitType; minutes: number | null; date: string; start_unit: number }>();
  if (row === null) return null;
  return { personId: row.person_id, startsAt: visitTimes(row.date, row.start_unit, heldMinutes(row)).start };
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

/**
 * What the client is told when ops refund a booking FSM would not take: the visit, and what comes back to them.
 * Sent only with their consent to WhatsApp about their visits, as every message about a visit is.
 */
export async function composeBookingRefunded(db: D1Database, holdId: string, personId: string): Promise<Composed> {
  if (!(await consentGiven(db, personId, "whatsapp_visits"))) return { skip: NO_VISITS_CONSENT };
  const hold = await db
    .prepare(
      `SELECT h.type, h.minutes, h.date, h.start_unit, p.name,
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
      name: string;
      paid: number | null;
      method: string | null;
    }>();
  if (hold === null) return { skip: "the booking is not given back" };
  const start = visitTimes(hold.date, hold.start_unit, heldMinutes(hold)).start;
  const params = [
    firstNameOf(hold.name),
    FSM_SERVICE_NAMES[hold.type].toLowerCase(),
    shortDate(indiaDate(start)),
    "",
    "",
    hold.paid === null ? "" : rupees(hold.paid),
    "",
    DESTINATIONS[hold.method ?? ""] ?? "payment method",
  ];
  return { template: hold.paid === null ? "booking_not_made_v1" : "booking_refunded_v1", params };
}
