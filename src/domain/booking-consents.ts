// The photograph consents a booking in the app gives (docs/decisions/0080-consents-given-by-booking.md). The pay
// step shows the lines for the purposes the client has never decided on, and the tap that starts a new booking keeps
// on its hold which it showed. Only once the booking is confirmed, paid for or free, is each purpose shown that is
// still undecided recorded, with the audit entry the profile's switch writes, on the notice holding exactly the lines
// shown. A Checkout closed unpaid records nothing, and a move gives none.

import { BOOKING_NOTICES } from "../config/notices.ts";
import { agreedByBooking, GIVEN_BY_BOOKING, type GivenByBooking } from "../policy/booking.ts";
import { auditStatementIfWritten } from "./audit.ts";
import { recordConsent } from "./consents.ts";
import { consentRecordsOf } from "./profile.ts";
import { graceEnds } from "./scheduling.ts";

export interface BookingTap {
  readonly personId: string;
  readonly holdId: string;
  /** The purposes the pay step showed the lines for. */
  readonly shown: readonly GivenByBooking[];
  readonly ipHash: string;
}

export interface Confirmation {
  readonly holdId: string;
  /** The request that confirmed it: the tap for a free visit, Razorpay's webhook for a paid one. */
  readonly requestId: string;
  readonly now: Date;
}

interface ConfirmedHold {
  readonly person_id: string;
  readonly confirmed_at: string;
  /** Comma-separated, as "photos_own_record,photos_referral_cards". */
  readonly consents_shown: string;
  readonly consents_ip_hash: string | null;
}

/** Keeps on the client's new booking what its pay step showed, until the booking is confirmed. */
export async function keepShownConsents(db: D1Database, tap: BookingTap): Promise<void> {
  const shown = GIVEN_BY_BOOKING.filter((purpose) => tap.shown.includes(purpose));
  const nothingShown = shown.length === 0;
  await db
    .prepare(
      `UPDATE slot_holds SET consents_shown = ?3, consents_ip_hash = ?4
       WHERE id = ?1 AND person_id = ?2 AND moves_appointment_id IS NULL`,
    )
    .bind(tap.holdId, tap.personId, nothingShown ? null : shown.join(","), nothingShown ? null : tap.ipHash)
    .run();
}

/**
 * The hold, once confirmed in time, while it has not been let go. A payment made after the hold and its grace ran out
 * is refunded and books nothing.
 */
async function confirmedHold(db: D1Database, holdId: string): Promise<ConfirmedHold | null> {
  return db
    .prepare(
      `SELECT person_id, confirmed_at, consents_shown, consents_ip_hash FROM slot_holds
       WHERE id = ?1 AND confirmed_at IS NOT NULL AND confirmed_at <= ${graceEnds("slot_holds")}
         AND state <> 'released' AND consents_shown IS NOT NULL AND moves_appointment_id IS NULL`,
    )
    .bind(holdId)
    .first<ConfirmedHold>();
}

/** The purposes a hold kept, of those a booking may agree to. */
function shownOn(hold: ConfirmedHold): GivenByBooking[] {
  const kept = hold.consents_shown.split(",");
  return GIVEN_BY_BOOKING.filter((purpose) => kept.includes(purpose));
}

/**
 * Records the consents a booking gave, as given when it was confirmed. Nothing while it is not confirmed, and nothing
 * twice however often it runs.
 */
export async function recordBookingConsents(db: D1Database, confirmation: Confirmation): Promise<void> {
  const hold = await confirmedHold(db, confirmation.holdId);
  if (hold === null) return;
  const shown = shownOn(hold);
  const notices = shown.length === 1 ? BOOKING_NOTICES.alone : BOOKING_NOTICES.both;
  const records = await consentRecordsOf(db, hold.person_id);
  const decided = records.filter((record) => record.since !== null).map((record) => record.purpose);

  const statements = agreedByBooking(shown, decided).flatMap((purpose) => {
    const grant = recordConsent(db, {
      person: { id: hold.person_id },
      purpose,
      granted: true,
      notice: notices[purpose],
      source: "app_booking",
      rule: "if_undecided",
      ipHash: hold.consents_ip_hash,
      givenAt: hold.confirmed_at,
    });
    const audit = auditStatementIfWritten(
      db,
      {
        surface: "client",
        actor: { kind: "client", id: hold.person_id },
        action: "consent.switch",
        subject: { kind: "hold", id: confirmation.holdId },
        requestId: confirmation.requestId,
        detail: { purpose, granted: true },
      },
      confirmation.now,
      { table: "consents", id: grant.id },
    );
    return [grant.statement, audit];
  });
  if (statements.length > 0) await db.batch(statements);
}
