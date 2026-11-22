// A booking ops made that waits on its payment link (pay by link, src/domain/booking/visit-booking.ts sendHoldLink):
// the client pays the link and it is booked, or it lapses and its time goes back. Razorpay texts the link only to a
// number messaging may text, so ops can see whether it went, send it again or copy it; the client sees it in their
// app; and ops can let one go that stands in the way of booking another of its kind (visit-booking.ts alreadyToCome).

import { onAllowlist, type MessagingSettings } from "../../config/settings.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { failureReason, type Logger } from "../../log.ts";
import type { PaymentsProvider } from "../../providers/payments/index.ts";
import { liveVisitOf, type LiveVisit } from "./availability.ts";
import { BOOKING_LEASE_MS } from "./bookings.ts";
import { giveBack } from "./give-back.ts";
import { graceEnds, heldOnLink } from "./hold-stages.ts";

/** A booking held on its payment link. */
export interface HeldBooking {
  readonly holdId: string;
  readonly type: VisitType;
  readonly date: string;
  /** Its start; null for one held before holds kept their start. */
  readonly startsAt: string | null;
  /** What the client pays, in paise, GST included. */
  readonly amount: number;
  /** Its link; null while it is still being made. */
  readonly url: string | null;
  /** When it is held until, as the client is told: a payment's grace past it is ours, never shown. */
  readonly openUntil: string;
  /** Paid, and being booked: it has no link to send, and cannot be let go. */
  readonly paid: boolean;
}

type HeldRow = {
  id: string;
  type: VisitType;
  date: string;
  starts_at: string | null;
  amount: number;
  payment_link_url: string | null;
  open_until: string;
  paid: number;
};

const heldOf = (row: HeldRow): HeldBooking => ({
  holdId: row.id,
  type: row.type,
  date: row.date,
  startsAt: row.starts_at,
  amount: row.amount,
  url: row.payment_link_url,
  openUntil: row.open_until,
  paid: row.paid === 1,
});

/**
 * The client's bookings held on their link at `now`, soonest first; of one kind alone where `type` is given. Read as
 * the refusal of a second of its kind reads them, so what refuses a booking is always among them.
 */
export async function heldBookingsOf(
  db: D1Database,
  personId: string,
  now: Date,
  type: VisitType | null = null,
): Promise<HeldBooking[]> {
  const { results } = await db
    .prepare(
      `SELECT h.id, h.type, h.date, h.starts_at, h.amount, h.payment_link_url, h.expires_at AS open_until,
         (h.confirmed_at IS NOT NULL OR h.razorpay_order_id IS NOT NULL) AS paid
       FROM slot_holds h JOIN people pe ON pe.id = h.person_id
       WHERE h.person_id = ?1 AND ${heldOnLink("h", "?2")} AND (?3 IS NULL OR h.type = ?3) AND pe.erased_at IS NULL
       ORDER BY h.date, h.starts_at`,
    )
    .bind(personId, now.toISOString(), type)
    .all<HeldRow>();
  return results.map(heldOf);
}

/** The client's held bookings still to pay, with their link: what their app asks them to pay. */
export async function heldToPayOf(db: D1Database, personId: string, now: Date): Promise<HeldToPay[]> {
  return (await heldBookingsOf(db, personId, now)).filter((held): held is HeldToPay => !held.paid && held.url !== null);
}

/** A held booking still to pay, by its link. */
type HeldToPay = HeldBooking & { readonly url: string };

/** The client a booking held on its link is for; null for no such hold. */
export async function heldBookingPerson(db: D1Database, holdId: string): Promise<string | null> {
  const hold = await db
    .prepare("SELECT person_id FROM slot_holds WHERE id = ?1 AND pay_by_link = 1")
    .bind(holdId)
    .first<{ person_id: string }>();
  return hold?.person_id ?? null;
}

/** What stands in the way of booking the client another visit of a kind: one still to come, or one held on its link. */
export interface InTheWay {
  /** The visit still to come, of its own kind: a one visit is refused by a consultation still to come too. */
  readonly visit: (LiveVisit & { readonly kind: VisitType }) | null;
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
  // A visit of the kind still to come counts one paid on its link too (liveVisitOf): it is named once, as the visit.
  if (visit !== null) return { visit: { ...visit, kind }, held: held.filter((each) => !each.paid) };
  return { visit: consultation === null ? null : { ...consultation, kind: "consultation" }, held };
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
export type LetGo = "let_go" | "not_found" | "closed" | "unavailable";

/**
 * Takes the hold's booking lease (bookings.ts confirmBooking) while it is let go, so a payment landing that moment
 * waits rather than books it; only for a hold nothing is paid on yet and no try is booking.
 */
async function leaseToLetGo(db: D1Database, holdId: string, now: Date): Promise<boolean> {
  const taken = await db
    .prepare(
      `UPDATE slot_holds SET booking_until = ?2
       WHERE id = ?1 AND pay_by_link = 1 AND state = 'held' AND confirmed_at IS NULL AND razorpay_order_id IS NULL
         AND (booking_until IS NULL OR booking_until <= ?3) RETURNING id`,
    )
    .bind(holdId, new Date(now.getTime() + BOOKING_LEASE_MS).toISOString(), now.toISOString())
    .first();
  return taken !== null;
}

/**
 * Where Razorpay would not cancel a link, what it holds it as now: shut (cancelled, as when a cancel went through but
 * its answer was lost, or expired), so it takes no payment; or paid. Null where it cannot say.
 */
async function linkNow(payments: PaymentsProvider, linkId: string): Promise<"shut" | "paid" | null> {
  try {
    const { status } = await payments.paymentLink(linkId);
    if (status === "paid") return "paid";
    return status === "cancelled" || status === "expired" ? "shut" : null;
  } catch {
    return null;
  }
}

/**
 * Lets an unpaid booking held on its link go, its time freed, as ops ask. Its link is cancelled first, under the
 * booking lease: Razorpay will not cancel a link once paid, so a cancelled one takes no payment after, and nothing is
 * refunded. A link Razorpay will not cancel because it is cancelled or expired already is let go all the same; one
 * paid, being booked, or whose link Razorpay will not cancel or say of is kept, its link open.
 */
export async function letHeldBookingGo(
  db: D1Database,
  deps: { readonly payments: PaymentsProvider; readonly log: Logger },
  holdId: string,
  written: { readonly now: Date; readonly reason: string; readonly alongside: readonly D1PreparedStatement[] },
): Promise<LetGo> {
  const hold = await db
    .prepare("SELECT payment_link_id FROM slot_holds WHERE id = ?1 AND pay_by_link = 1")
    .bind(holdId)
    .first<{ payment_link_id: string | null }>();
  if (hold === null) return "not_found";
  if (!(await leaseToLetGo(db, holdId, written.now))) return "closed";
  try {
    if (hold.payment_link_id !== null) {
      try {
        await deps.payments.cancelPaymentLink(hold.payment_link_id);
      } catch (error) {
        const now = await linkNow(deps.payments, hold.payment_link_id);
        if (now === "paid") return "closed";
        if (now === null) {
          deps.log.warn("hold_link_not_cancelled", { hold_id: holdId, reason: failureReason(error) });
          return "unavailable";
        }
      }
    }
    const given = await giveBack({ db, payments: deps.payments, now: written.now }, holdId, written.reason, {
      alongside: written.alongside,
    });
    return given.kind === "booked" ? "closed" : "let_go";
  } finally {
    await db.prepare("UPDATE slot_holds SET booking_until = NULL WHERE id = ?1").bind(holdId).run();
  }
}
