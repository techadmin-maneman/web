// The half-hour pass: a paid hold whose request failed before its visit was written is booked again, and ops are
// told of one that still is not.

import type { CallBudget } from "../lib/call-budget.ts";
import { failureReason, type Logger } from "../log.ts";
import type { PaymentsProvider } from "../providers/payments/index.ts";
import { type AlertOnce, type ResolveAlert } from "./alerts.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import { paidNotBooked } from "./hold-stages.ts";
import { type ConfirmOptions, type Confirmed } from "./booked-hold.ts";
import { confirmBooking } from "./bookings.ts";

/** How long a confirmed hold may wait to be booked before the cron books it. */
const UNBOOKED_AFTER_MS = 30 * MINUTE_MS;

const BOOKED_PER_PASS = 20;

/** The alert a hold raises while it waits unbooked; closed once it is booked or given back. */
const unbookedAlertKey = (holdId: string) => `unbooked_hold:${holdId}`;

interface UnbookedHold {
  readonly id: string;
  readonly person_id: string;
}

/** Confirmed holds neither booked nor refunded half an hour after they last went to be booked, oldest first. */
async function unbookedHolds(db: D1Database, now: Date): Promise<UnbookedHold[]> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id FROM slot_holds WHERE ${paidNotBooked("slot_holds")} AND queued_at <= ?1
       ORDER BY queued_at LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - UNBOOKED_AFTER_MS).toISOString(), BOOKED_PER_PASS)
    .all<UnbookedHold>();
  return results;
}

interface UnbookedPass {
  readonly payments: PaymentsProvider;
  readonly alertOnce: AlertOnce;
  readonly resolveAlert: ResolveAlert;
  /** Queues a message about the visit once its row is written. */
  readonly notify: (messageId: string) => Promise<unknown>;
  readonly budget: CallBudget;
  readonly log: Logger;
}

/**
 * Holds paid for, or booked free, that are neither booked nor refunded half an hour after they were confirmed, because
 * the request that confirmed them failed part-way. Each is booked here, one call from the run's budget, since giving
 * one back asks Razorpay for its refund. One that still cannot be is tried again half an hour on, and ops are told
 * once. Returns how many were booked.
 */
export async function bookUnbookedHolds(db: D1Database, pass: UnbookedPass, now: Date): Promise<number> {
  let booked = 0;
  for (const hold of await unbookedHolds(db, now)) {
    if (!pass.budget.spend(1)) break;
    await db.prepare("UPDATE slot_holds SET queued_at = ?2 WHERE id = ?1").bind(hold.id, now.toISOString()).run();
    if ((await bookUnbookedHold(db, pass, hold, now)) === "booked") booked += 1;
  }
  return booked;
}

async function bookUnbookedHold(
  db: D1Database,
  pass: UnbookedPass,
  hold: UnbookedHold,
  now: Date,
): Promise<Confirmed | null> {
  const options: ConfirmOptions = { notify: pass.notify, alertOnce: pass.alertOnce, log: pass.log };
  try {
    const outcome = await confirmBooking(db, pass.payments, hold.id, now, options);
    pass.log.info("unbooked_hold_booked", { hold_id: hold.id, outcome });
    if (outcome !== "being_booked") await pass.resolveAlert(unbookedAlertKey(hold.id));
    return outcome;
  } catch (error) {
    const reason = failureReason(error);
    pass.log.warn("unbooked_hold_failed", { hold_id: hold.id, reason });
    await pass.alertOnce({
      key: unbookedAlertKey(hold.id),
      message:
        `Booking ${hold.id} was paid for, or booked free, and is neither booked nor refunded half an hour on: ` +
        `${reason}. It is tried again every half hour.`,
      link: `/clients/${hold.person_id}`,
    });
    return null;
  }
}
