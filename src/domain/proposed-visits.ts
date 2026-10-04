// A consultation a form asked for, which stands for the visit until one is on record: the latest lead with a date,
// and what it asked for. The Home card shows it (GET /api/me), and both the Home card and the console count it
// towards a client being a lead.

import type { VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import { askedWindowOf } from "./asked-windows.ts";

/** A booking a form left: the date it booked, its Phase 1 rough window if it had one, and the city named. */
export interface ProposedBooking {
  readonly proposed_visit_date: string;
  readonly first_choice_window: VisitWindow | null;
  readonly city: string | null;
}

/** What a form's booking asked for. */
export interface Asked {
  readonly window: BookingWindow;
  /** Asked for with no slot held: ops confirm the time on WhatsApp. */
  readonly requested: boolean;
  /** The consultation and the first fit in one visit. */
  readonly oneVisit: boolean;
}

/** The latest booking a form left with a date; null when none has. */
export function latestProposal(db: D1Database, personId: string): Promise<ProposedBooking | null> {
  return db
    .prepare(
      `SELECT proposed_visit_date, first_choice_window, city FROM leads
       WHERE person_id = ?1 AND proposed_visit_date IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<ProposedBooking>();
}

/**
 * The booking Home shows as the client's consultation: only while no visit of theirs is on record, and only until
 * its day has passed, when the client may book again.
 */
export async function standingProposal(
  db: D1Database,
  personId: string,
  booking: ProposedBooking | null,
  today: string,
): Promise<ProposedBooking | null> {
  if (booking === null) return null;
  if (booking.proposed_visit_date < today) return null;
  if (await hasVisit(db, personId)) return null;
  return booking;
}

async function hasVisit(db: D1Database, personId: string): Promise<boolean> {
  const visit = await db
    .prepare("SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL LIMIT 1")
    .bind(personId)
    .first();
  return visit !== null;
}

/**
 * What a booking asked for. A Phase 1 lead carries its own rough choice, and booked nothing: ops fixed the hour on
 * WhatsApp. A booking from the site's form asked on the slot it held or, while self-serve booking is off, on the
 * request ops confirm. Null when neither is found.
 */
export async function askedFor(db: D1Database, personId: string, booking: ProposedBooking): Promise<Asked | null> {
  if (booking.first_choice_window !== null) {
    return { window: askedWindowOf(booking.first_choice_window), requested: true, oneVisit: false };
  }
  const asked = await db
    .prepare(
      `SELECT asked, requested, one_visit FROM (
         SELECT requested_window AS asked, 1 AS requested, one_visit, created_at FROM consultation_requests
         WHERE person_id = ?1 AND requested_date = ?2
         UNION ALL
         SELECT window_label AS asked, 0 AS requested, 0 AS one_visit, created_at FROM slot_holds
         WHERE person_id = ?1 AND date = ?2 AND type = 'consultation'
       ) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId, booking.proposed_visit_date)
    .first<{ asked: BookingWindow; requested: number; one_visit: number }>();
  if (asked === null) return null;
  return { window: asked.asked, requested: asked.requested === 1, oneVisit: asked.one_visit === 1 };
}
