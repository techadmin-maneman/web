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
//
// Each visit is handled on its own (docs/decisions/0067-alerts-and-silent-failures.md).
// One FSM refuses is marked looked-at with no window, since asking again will
// not change the answer; one FSM fails on waits an hour. Either way the pass
// goes on to the next.

import { windowLabel, type VisitWindow } from "../config/booking.ts";
import type { BookingWindow } from "../config/scheduling.ts";
import type { CallBudget } from "../lib/call-budget.ts";
import type { Logger } from "../log.ts";
import type { FsmProvider, FsmRequestPreference } from "../providers/fsm.ts";
import { isRefusal } from "../providers/provider-error.ts";

/** How many a pass looks up at most. */
export const PER_PASS = 5;
/** Outside calls one visit costs: its work order, then the Request it came from. */
export const CALLS_PER_VISIT = 2;
/** A visit FSM failed on is asked about again an hour later. */
export const RECHECK_AFTER_MS = 60 * 60 * 1000;

interface Visit {
  id: string;
  fsm_work_order_id: string;
}

/**
 * The window a Phase 1 booking's choice falls in: its two are morning and
 * evening, the same mapping `sendLeadToFsm` writes into the Request's note
 * (docs/decisions/0040-phase-1-alignment.md).
 */
export const askedWindowOf = (choice: VisitWindow): BookingWindow =>
  windowLabel(choice) === "before noon" ? "morning" : "evening";

export async function resolveAskedWindows(
  db: D1Database,
  fsm: FsmProvider,
  now: Date,
  log: Logger,
  budget: CallBudget,
): Promise<{ resolved: number }> {
  const at = now.toISOString();
  const recheck = new Date(now.getTime() - RECHECK_AFTER_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, fsm_work_order_id FROM appointments
       WHERE asked_checked_at IS NULL AND fsm_work_order_id IS NOT NULL AND deleted_at IS NULL
         AND status IN ('scheduled', 'dispatched', 'in_progress')
         AND (asked_failed_at IS NULL OR asked_failed_at < ?2)
       ORDER BY window_start LIMIT ?1`,
    )
    .bind(PER_PASS, recheck)
    .all<Visit>();

  let resolved = 0;
  for (const visit of results) {
    if (!budget.spend(CALLS_PER_VISIT)) break;
    const window = await askedFor(db, fsm, visit, at, log);
    if (window !== null) resolved += 1;
  }
  return { resolved };
}

/** One visit's asked window, kept; null where there is none, or where FSM would not say this time. */
async function askedFor(
  db: D1Database,
  fsm: FsmProvider,
  visit: Visit,
  at: string,
  log: Logger,
): Promise<BookingWindow | null> {
  let asked: FsmRequestPreference | null;
  try {
    asked = await fsm.requestPreference(visit.fsm_work_order_id);
  } catch (error) {
    if (isRefusal(error)) {
      log.warn("asked_window_refused", { appointment_id: visit.id, status: error.status, code: error.code });
      await markLookedAt(db, visit.id, null, at);
      return null;
    }
    log.warn("asked_window_failed", { appointment_id: visit.id, error });
    await db.prepare("UPDATE appointments SET asked_failed_at = ?1 WHERE id = ?2").bind(at, visit.id).run();
    return null;
  }

  const window = asked === null ? null : await windowAskedFor(db, asked.requestId);
  await markLookedAt(db, visit.id, window, at);
  return window;
}

async function markLookedAt(db: D1Database, id: string, window: BookingWindow | null, at: string): Promise<void> {
  await db
    .prepare("UPDATE appointments SET asked_window = ?1, asked_checked_at = ?2 WHERE id = ?3")
    .bind(window, at, id)
    .run();
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
