// The photograph consents a booking in the app gives (docs/decisions/0080-consents-given-by-booking.md). The pay
// step shows the lines for the purposes the client has never decided on, and the tap that starts the booking is
// their agreement: each purpose it showed that is still undecided is recorded, through the ledger the profile's
// switch writes, with the same audit entry, on the notice holding exactly the lines shown. A move gives none.

import { BOOKING_NOTICES } from "../config/notices.ts";
import { agreedByBooking, GIVEN_BY_BOOKING, type GivenByBooking } from "../policy/booking.ts";
import { auditStatementIfWritten } from "./audit.ts";
import { consentRecordsOf, grantIfUndecided } from "./profile.ts";

export interface BookingTap {
  readonly personId: string;
  readonly holdId: string;
  /** The purposes the pay step showed the lines for. */
  readonly shown: readonly GivenByBooking[];
  readonly ipHash: string;
  readonly requestId: string;
  readonly now: Date;
}

/** Whether the hold is one of the client's new bookings, not a move of a visit they have. */
async function isNewBooking(db: D1Database, personId: string, holdId: string): Promise<boolean> {
  const hold = await db
    .prepare("SELECT 1 FROM slot_holds WHERE id = ?1 AND person_id = ?2 AND moves_appointment_id IS NULL")
    .bind(holdId, personId)
    .first();
  return hold !== null;
}

/** Records the consents a booking gave, once the tap has started it. */
export async function recordBookingConsents(db: D1Database, tap: BookingTap): Promise<void> {
  const shown = GIVEN_BY_BOOKING.filter((purpose) => tap.shown.includes(purpose));
  if (shown.length === 0 || !(await isNewBooking(db, tap.personId, tap.holdId))) return;
  const notices = shown.length === 1 ? BOOKING_NOTICES.alone : BOOKING_NOTICES.both;
  const records = await consentRecordsOf(db, tap.personId);
  const decided = records.filter((record) => record.since !== null).map((record) => record.purpose);

  const statements = agreedByBooking(shown, decided).flatMap((purpose) => {
    const grant = grantIfUndecided(db, {
      personId: tap.personId,
      purpose,
      noticeVersion: notices[purpose],
      ipHash: tap.ipHash,
      now: tap.now,
    });
    const audit = auditStatementIfWritten(
      db,
      {
        surface: "client",
        actor: { kind: "client", id: tap.personId },
        action: "consent.switch",
        subject: { kind: "hold", id: tap.holdId },
        requestId: tap.requestId,
        detail: { purpose, granted: true },
      },
      tap.now,
      { table: "consents", id: grant.id },
    );
    return [grant.statement, audit];
  });
  if (statements.length > 0) await db.batch(statements);
}
