// What the client asked for, as against what the board is offering them
// (docs/decisions/0063-the-asked-window.md).
//
// FSM holds one time on an appointment and nothing else: its own Preference
// subform is read-only there. The window the client asked for is on the Request
// the visit's work order was converted from, and we wrote that Request
// ourselves from the lead. So this pass walks the link once — work order to
// Request — and reads the window out of the lead the Request came from, rather
// than parsing back words we wrote. One read per visit, ever, kept in
// `asked_window`; a visit with no Request behind it is marked looked-at and
// never asked about again.
//
// On the five-minute cron, beside the invoice pass, and never in ops' path: the
// board reads the column.

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import type { Logger } from "../log.ts";
import type { FsmProvider, FsmRequestPreference } from "../providers/fsm.ts";
import { ZohoError } from "../providers/zoho-http.ts";

/** How many a pass looks up, well inside a cron run's outside calls. */
export const PER_PASS = 5;

/**
 * The window a Phase 1 booking's choice falls in: its two are morning and
 * evening, the same mapping `sendLeadToFsm` writes into the Request's note
 * (docs/decisions/0040-phase-1-alignment.md).
 */
export const askedWindowOf = (choice: VisitWindow): BookingWindow =>
  windowLabel(choice) === "before noon" ? "morning" : "evening";

/** FSM refuses it: a 4xx, which asking again at once will not change. */
const refused = (error: unknown): error is ZohoError =>
  error instanceof ZohoError && error.status >= 400 && error.status < 500;

export async function resolveAskedWindows(
  db: D1Database,
  fsm: FsmProvider,
  now: Date,
  log: Logger,
): Promise<{ resolved: number }> {
  const at = now.toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, fsm_work_order_id FROM appointments
       WHERE asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL
         AND status IN ('scheduled', 'dispatched', 'in_progress')
       ORDER BY window_start LIMIT ?1`,
    )
    .bind(PER_PASS)
    .all<{ id: string; fsm_work_order_id: string }>();

  let resolved = 0;
  for (const appointment of results) {
    let asked: FsmRequestPreference | null;
    try {
      asked = await fsm.requestPreference(appointment.fsm_work_order_id);
    } catch (error) {
      if (!refused(error)) throw error;
      // Nothing is stamped: the visit is offered again next pass, rather than
      // settled from an answer FSM never gave.
      log.warn("asked_window_refused", { appointment_id: appointment.id, status: error.status, code: error.code });
      continue;
    }

    const window = asked === null ? null : await windowAskedFor(db, asked.requestId);
    await db
      .prepare("UPDATE appointments SET asked_window = ?1, asked_checked_at = ?2 WHERE id = ?3")
      .bind(window, at, appointment.id)
      .run();
    if (window !== null) resolved += 1;
  }
  return { resolved };
}

/**
 * The window the lead behind this Request asked for. Ours, not FSM's: the
 * Request's note carries the same choice in the words we sent, and reading it
 * back as prose would be a guess where the lead is a fact.
 */
async function windowAskedFor(db: D1Database, requestId: string): Promise<BookingWindow | null> {
  const lead = await db
    .prepare("SELECT first_choice_window FROM leads WHERE fsm_request_id = ?1 AND first_choice_window IS NOT NULL")
    .bind(requestId)
    .first<{ first_choice_window: VisitWindow }>();
  return lead === null ? null : askedWindowOf(lead.first_choice_window);
}
