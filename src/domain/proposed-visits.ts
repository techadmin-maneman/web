// A consultation a form booked, which stands for the visit until one is booked (docs/decisions/0051-booking-from-the-site.md):
// the latest lead with a date, and the window it asked for. The Home card shows it (GET /api/me), and both the Home
// card and the console count it towards a client being a lead.

import type { VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import { askedWindowOf } from "./asked-windows.ts";

/** A booking a form left: the date it booked, its Phase 1 rough window if it had one, and the city named. */
export interface ProposedBooking {
  readonly proposed_visit_date: string;
  readonly first_choice_window: VisitWindow | null;
  readonly city: string | null;
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

/** Whether the person has any visit yet: a form's proposal stands only until they do. */
export async function hasVisit(db: D1Database, personId: string): Promise<boolean> {
  const visit = await db
    .prepare("SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL LIMIT 1")
    .bind(personId)
    .first();
  return visit !== null;
}

/**
 * The window a booking asked for. A Phase 1 lead carries its own rough choice.
 * A booking from the site's form carries none: its window is on the slot it
 * held or, while self-serve booking is off, on the request ops confirm
 * (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
 */
export async function windowAskedFor(
  db: D1Database,
  personId: string,
  booking: ProposedBooking,
): Promise<BookingWindow | null> {
  if (booking.first_choice_window !== null) return askedWindowOf(booking.first_choice_window);
  const asked = await db
    .prepare(
      `SELECT asked FROM (
         SELECT requested_window AS asked, created_at FROM consultation_requests
         WHERE person_id = ?1 AND requested_date = ?2
         UNION ALL
         SELECT window_label AS asked, created_at FROM slot_holds
         WHERE person_id = ?1 AND date = ?2 AND type = 'consultation'
       ) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId, booking.proposed_visit_date)
    .first<{ asked: BookingWindow }>();
  return asked?.asked ?? null;
}
