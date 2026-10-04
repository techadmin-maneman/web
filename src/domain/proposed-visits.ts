// A consultation a form booked, which stands for the visit until FSM has one (docs/decisions/0051-booking-from-the-site.md):
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

/** Whether FSM has any visit of the person's yet: a form's proposal stands only until it does. */
export async function hasFsmVisit(db: D1Database, personId: string): Promise<boolean> {
  const visit = await db
    .prepare("SELECT 1 FROM appointments WHERE person_id = ?1 AND deleted_at IS NULL LIMIT 1")
    .bind(personId)
    .first();
  return visit !== null;
}

/** What a booking asked for: its window and, from a request, whether it is a consultation and fit in one visit. */
export interface AskedFor {
  readonly window: BookingWindow;
  readonly oneVisit: boolean;
  /** The discount code typed on /book for a one visit; null for none. */
  readonly code: string | null;
}

/**
 * What a booking asked for. A Phase 1 lead carries its own rough choice of
 * window. A booking from the site's form carries none: its window is on the
 * consultation slot it held or, while self-serve booking is off, on the request
 * ops confirm (docs/decisions/0060-an-invited-friend-reaches-ops-and-the-crm.md).
 */
export async function askedFor(db: D1Database, personId: string, booking: ProposedBooking): Promise<AskedFor | null> {
  if (booking.first_choice_window !== null) {
    return { window: askedWindowOf(booking.first_choice_window), oneVisit: false, code: null };
  }
  const asked = await db
    .prepare(
      `SELECT asked, one_visit, code FROM (
         SELECT requested_window AS asked, one_visit, discount_code AS code, created_at FROM consultation_requests
         WHERE person_id = ?1 AND requested_date = ?2
         UNION ALL
         SELECT window_label AS asked, 0 AS one_visit, NULL AS code, created_at FROM slot_holds
         WHERE person_id = ?1 AND date = ?2 AND type = 'consultation'
       ) ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId, booking.proposed_visit_date)
    .first<{ asked: BookingWindow; one_visit: number; code: string | null }>();
  if (asked === null) return null;
  return { window: asked.asked, oneVisit: asked.one_visit === 1, code: asked.code };
}
