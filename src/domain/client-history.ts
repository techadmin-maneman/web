// What we know of one client: how often they have been served, what they have
// bought, and when their piece falls due. Counted from the rows themselves at
// the moment someone looks, as board D2's tasks and board D1's money are
// (src/domain/tasks.ts, src/domain/day-money.ts). There is no counts table and
// there is not going to be one: a tally kept anywhere could drift from the
// visits and payments behind it, and the client and ops read the same figures.
//
// One statement answers the whole record, so a client's page costs one D1 read
// however many visits they have had.
//
// A visit done is a completed appointment with a window, which is what
// `isFitted` and the client's own list of past visits already mean by one
// (src/domain/client-visits.ts). A visit FSM terminated did not happen and is
// counted nowhere.

import { indiaDate } from "../lib/india-time.ts";

/** When the piece now in wear falls due, and which piece it is. */
export interface ReplacementDue {
  /** YYYY-MM-DD, as the piece's row holds it: the date ops order a piece against. */
  readonly on: string;
  /**
   * YYYY-MM, and all the client is ever told. `syncPieces` recomputes the day
   * from FSM's install date on every sync, so a date shown to a client can move
   * under them; the month it falls in is the most we can promise (ADR 0059).
   */
  readonly month: string;
  readonly piece_code: string;
}

export interface ClientHistory {
  /** Every visit done, of whatever kind. */
  readonly visits: number;
  readonly services: number;
  readonly replacements: number;
  /**
   * India's date of the first fit, and null when none is recorded: a client
   * whose earlier visits FSM never held is fitted with no fit on record, and a
   * date would have to be invented for them.
   */
  readonly first_fit_on: string | null;
  /** India's date of the latest visit done; null before the first one. */
  readonly last_visit_on: string | null;
  /**
   * In paise: every payment Razorpay captured, less what it has since sent
   * back. A visit covered by a credit cost nothing and adds nothing.
   */
  readonly spend: number;
  /** Null when no piece is in wear, which has no date rather than a distant one. */
  readonly replacement_due: ReplacementDue | null;
}

/** A visit that happened, as the client's own list of past visits counts one. */
const DONE = `person_id = ?1 AND deleted_at IS NULL AND status = 'completed'
  AND window_start IS NOT NULL AND window_end IS NOT NULL`;

/**
 * The whole record in one statement. The pieces still in wear drive the last
 * two figures: a piece that has failed has been replaced and falls due never.
 */
const HISTORY = `SELECT
  (SELECT COUNT(*) FROM appointments WHERE ${DONE}) AS visits,
  (SELECT COUNT(*) FROM appointments WHERE ${DONE} AND type = 'service') AS services,
  (SELECT COUNT(*) FROM appointments WHERE ${DONE} AND type = 'replacement') AS replacements,
  (SELECT MIN(window_start) FROM appointments WHERE ${DONE} AND type = 'first_fit') AS first_fit_at,
  (SELECT MAX(window_start) FROM appointments WHERE ${DONE}) AS last_visit_at,
  (SELECT COALESCE(SUM(amount - refunded_amount), 0) FROM payments
     WHERE person_id = ?1 AND captured_at IS NOT NULL) AS spend,
  (SELECT MIN(replacement_due_at) FROM pieces
     WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL
       AND replacement_due_at IS NOT NULL) AS due_on,
  (SELECT piece_code FROM pieces
     WHERE person_id = ?1 AND deleted_at IS NULL AND failed_at IS NULL
       AND replacement_due_at IS NOT NULL
     ORDER BY replacement_due_at, piece_code LIMIT 1) AS due_piece`;

interface Row {
  visits: number;
  services: number;
  replacements: number;
  first_fit_at: string | null;
  last_visit_at: string | null;
  spend: number;
  due_on: string | null;
  due_piece: string | null;
}

const NOTHING: ClientHistory = {
  visits: 0,
  services: 0,
  replacements: 0,
  first_fit_on: null,
  last_visit_on: null,
  spend: 0,
  replacement_due: null,
};

const dateOf = (instant: string | null) => (instant === null ? null : indiaDate(new Date(instant)));

/**
 * One client's history. The caller has already found the person and knows they
 * are not erased, as both the ops record and the client's own session do; this
 * reads by ID and joins nobody.
 */
export async function clientHistory(db: D1Database, personId: string): Promise<ClientHistory> {
  const row = await db.prepare(HISTORY).bind(personId).first<Row>();
  if (row === null) return NOTHING;
  return {
    visits: row.visits,
    services: row.services,
    replacements: row.replacements,
    first_fit_on: dateOf(row.first_fit_at),
    last_visit_on: dateOf(row.last_visit_at),
    spend: row.spend,
    replacement_due:
      row.due_on === null || row.due_piece === null
        ? null
        : { on: row.due_on, month: row.due_on.slice(0, 7), piece_code: row.due_piece },
  };
}
