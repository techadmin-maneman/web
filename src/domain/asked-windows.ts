// What the client asked for, as against what the board is offering them
// (docs/decisions/0063-the-asked-window.md).
//
// FSM holds one time on an appointment and nothing else. With self-serve
// booking off, the site's form books nothing: ops put the consultation in FSM
// themselves, from the day and window the form kept in consultation_requests.
// So a consultation takes the window of the client's latest request (BIZ-23),
// kept once in `asked_window`; any other visit is marked looked-at with none,
// since a visit our own booking made is booked into the window the client
// picked.
//
// Until 1 October 2026 this pass also asked FSM for the Request a visit's work
// order was converted from, for the window a Phase 1 lead asked for. Nothing of
// ours makes a Request any more (docs/decisions/0101-phase-1s-path-into-fsm-removed.md),
// so the pass reads only D1.
//
// On the cron, once an hour, and never in ops' path: the board reads the column.

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";

/** How many a pass looks at, at most. */
export const PER_PASS = 5;

interface Visit {
  id: string;
  person_id: string | null;
  type: string | null;
}

/**
 * The window a Phase 1 booking's choice falls in: its two are morning and
 * evening (docs/decisions/0040-phase-1-alignment.md).
 */
export const askedWindowOf = (choice: VisitWindow): BookingWindow =>
  windowLabel(choice) === "before noon" ? "morning" : "evening";

export async function resolveAskedWindows(db: D1Database, now: Date): Promise<{ resolved: number }> {
  const { results } = await db
    .prepare(
      `SELECT id, person_id, type FROM appointments
       WHERE asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL
         AND status IN ('scheduled', 'dispatched', 'in_progress')
       ORDER BY window_start LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<Visit>();

  let resolved = 0;
  for (const visit of results) {
    const window = await windowRequested(db, visit);
    await db
      .prepare("UPDATE appointments SET asked_window = ?1, asked_checked_at = ?2 WHERE id = ?3")
      .bind(window, now.toISOString(), visit.id)
      .run();
    if (window !== null) resolved += 1;
  }
  return { resolved };
}

/**
 * The window the client's latest consultation request asked for, for a
 * consultation: what the site's form keeps while self-serve booking is off.
 * The day may not be the one ops gave, which is why the tray writes the
 * window alone (ADR 0069).
 */
async function windowRequested(db: D1Database, visit: Visit): Promise<BookingWindow | null> {
  if (visit.type !== "consultation" || visit.person_id === null) return null;
  const request = await db
    .prepare(
      `SELECT requested_window FROM consultation_requests WHERE person_id = ?1
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(visit.person_id)
    .first<{ requested_window: BookingWindow }>();
  return request?.requested_window ?? null;
}
