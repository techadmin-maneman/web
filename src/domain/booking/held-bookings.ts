// A booking ops made that waits on its payment link (pay by link, src/domain/booking/visit-booking.ts sendHoldLink):
// the client pays the link and it is booked, or it lapses and its time goes back. Razorpay texts the link only to a
// number messaging may text, so ops can see whether it went, send it again or copy it; the client sees it in their
// app; and ops can let one go that stands in the way of booking another of its kind (visit-booking.ts alreadyToCome).

import { onAllowlist, type MessagingSettings } from "../../config/settings.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { failureReason, type Logger } from "../../log.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { liveVisitOf, type LiveVisit } from "./availability.ts";
import { giveBack } from "./give-back.ts";
import { graceEnds } from "./hold-stages.ts";

/** A booking held while its payment link is still open. */
export interface HeldBooking {
  readonly holdId: string;
  readonly type: VisitType;
  readonly date: string;
  /** Its start; null for one held before holds kept their start. */
  readonly startsAt: string | null;
  /** What the client pays, in paise, GST included. */
  readonly amount: number;
  readonly url: string;
  /** The last moment a payment for it books it. */
  readonly openUntil: string;
}

type HeldRow = {
  id: string;
  type: VisitType;
  date: string;
  starts_at: string | null;
  amount: number;
  payment_link_url: string;
  open_until: string;
};

/** Held, paid by a link that was made, not yet paid, and open still at `?2`. */
const OPEN = `h.state = 'held' AND h.pay_by_link = 1 AND h.confirmed_at IS NULL AND h.payment_link_url IS NOT NULL
  AND ${graceEnds("h")} > ?2`;

const heldOf = (row: HeldRow): HeldBooking => ({
  holdId: row.id,
  type: row.type,
  date: row.date,
  startsAt: row.starts_at,
  amount: row.amount,
  url: row.payment_link_url,
  openUntil: row.open_until,
});

/** The client's bookings waiting on their link at `now`, soonest first; of one kind alone where `type` is given. */
export async function heldBookingsOf(
  db: D1Database,
  personId: string,
  now: Date,
  type: VisitType | null = null,
): Promise<HeldBooking[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.type, h.date, h.starts_at, h.amount, h.payment_link_url, ${graceEnds("h")} AS open_until
       FROM slot_holds h JOIN people pe ON pe.id = h.person_id
       WHERE h.person_id = ?1 AND ${OPEN} AND (?3 IS NULL OR h.type = ?3) AND pe.erased_at IS NULL
       ORDER BY h.date, h.starts_at`,
    )
    .bind(personId, now.toISOString(), type)
    .all<HeldRow>();
  return results.map(heldOf);
}

/** What stands in the way of booking the client another visit of a kind: one still to come, or one held on its link. */
export interface InTheWay {
  readonly visit: LiveVisit | null;
  readonly held: readonly HeldBooking[];
}

/** What refuses a booking as already_booked, read as that refusal reads it, so ops can be told which it is. */
export async function inTheWay(
  db: D1Database,
  asked: { readonly personId: string; readonly kind: VisitType; readonly oneVisit: boolean; readonly now: Date },
): Promise<InTheWay> {
  const { personId, kind, oneVisit, now } = asked;
  const [visit, consultation, held] = await Promise.all([
    liveVisitOf(db, personId, { type: kind, now }),
    oneVisit ? liveVisitOf(db, personId, { type: "consultation", now }) : null,
    heldBookingsOf(db, personId, now, kind),
  ]);
  return { visit: visit ?? consultation, held };
}

/** What sending a held booking's link again came to. */
export type HeldLinkSent = "resent" | "not_texted" | "not_found" | "closed" | "unavailable";

type HoldLinkRow = { payment_link_id: string | null; mobile_e164: string; open: number };

/**
 * Asks Razorpay to text a held booking's link again. A number messaging may not text (a staging test record) is told
 * so rather than sent nothing silently; a booking paid, lapsed or let go has no link to send.
 */
export async function resendHeldLink(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly log: Logger; readonly messagingSettings: MessagingSettings },
  holdId: string,
  now: Date,
): Promise<HeldLinkSent> {
  const hold = await db
    .prepare(
      `SELECT h.payment_link_id, pe.mobile_e164,
         (h.state = 'held' AND h.pay_by_link = 1 AND h.confirmed_at IS NULL AND ${graceEnds("h")} > ?2) AS open
       FROM slot_holds h JOIN people pe ON pe.id = h.person_id
       WHERE h.id = ?1 AND h.pay_by_link = 1 AND pe.erased_at IS NULL`,
    )
    .bind(holdId, now.toISOString())
    .first<HoldLinkRow>();
  const linkId = hold?.payment_link_id ?? null;
  if (linkId === null) return "not_found";
  if (hold?.open !== 1) return "closed";
  if (!onAllowlist(deps.messagingSettings, hold.mobile_e164)) {
    deps.log.info("payment_link_not_texted", { hold_id: holdId });
    return "not_texted";
  }
  try {
    await deps.payments.resendPaymentLink(linkId);
  } catch (error) {
    deps.log.warn("hold_link_resend_failed", { hold_id: holdId, reason: failureReason(error) });
    return "unavailable";
  }
  deps.log.info("hold_link_resent", { hold_id: holdId });
  return "resent";
}

/** What letting a held booking go came to. */
export type LetGo = "let_go" | "not_found" | "closed";

/**
 * Lets a booking held on its link go, its time freed, as ops ask: its link is cancelled first, so it takes no
 * payment after; one Razorpay will not cancel (paid or lapsed that moment) is let go all the same, and a payment that
 * came in time is refunded by the give-back, once.
 */
export async function letHeldBookingGo(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly log: Logger },
  holdId: string,
  written: { readonly now: Date; readonly reason: string; readonly alongside: readonly D1PreparedStatement[] },
): Promise<LetGo> {
  const hold = await db
    .prepare("SELECT state, payment_link_id FROM slot_holds WHERE id = ?1 AND pay_by_link = 1")
    .bind(holdId)
    .first<{ state: string; payment_link_id: string | null }>();
  if (hold === null) return "not_found";
  if (hold.state !== "held") return "closed";
  if (hold.payment_link_id !== null) {
    try {
      await deps.payments.cancelPaymentLink(hold.payment_link_id);
    } catch (error) {
      deps.log.warn("hold_link_not_cancelled", { hold_id: holdId, reason: failureReason(error) });
    }
  }
  const given = await giveBack({ db, payments: deps.payments, now: written.now }, holdId, written.reason, {
    alongside: written.alongside,
  });
  return given.kind === "booked" ? "closed" : "let_go";
}
