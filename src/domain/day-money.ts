// A day's money, as board D1 draws it: what was collected, what went back, and
// each charge that was kept or ruled on. Derived from the rows Razorpay's
// webhook and the visit changes already write, the way board D2's tasks are
// derived (src/domain/tasks.ts); no total is accumulated anywhere, so none can
// drift from the payments behind it.
//
// Every amount is in paise, as migration 0014 keeps them. Razorpay is the
// record of what was paid and refunded (docs/decisions/0044-payments-mirror.md),
// so a payment counts as collected from the moment its capture reached us, and
// a refund from the moment Razorpay reported it processed.

import { addDays, indiaInstant } from "../lib/india-time.ts";

/** The board's three figures, and what the third leaves out. */
export interface DayFigures {
  /** In paise, captured on the day: the board's "Collected today". */
  readonly collected: number;
  /** In paise, asked for on the day and not back with the client yet: "Refunds processing". */
  readonly refunds_processing: number;
  /** In paise, processed by Razorpay on the day, which the board draws no figure of its own for. */
  readonly refunded: number;
  /**
   * In paise, kept from the client on the day: "Charges and no-shows". A no-show
   * is not in it, because nothing records what one was charged; how many were
   * ruled charged is counted below instead.
   */
  readonly charged: number;
  /**
   * How many no-shows ops ruled charged on the day. Counted rather than added,
   * so the figure above is never read as the whole of what was kept
   * (docs/open-points.md, item 57).
   */
  readonly no_shows_charged: number;
}

export type ChargeKind = "late_cancellation" | "no_show";

/** One line of "No-shows and late cancellations": who it was, what it was, and the evidence for it. */
export interface Charge {
  readonly id: string;
  readonly kind: ChargeKind;
  /** Null for a visit FSM never matched to one of our people. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /**
   * In paise, and null on a no-show: ops record the ruling and nothing records
   * an amount, because the charge itself is applied at P2-M5
   * (src/routes/ops-field.ts, docs/open-points.md, item 57).
   */
  readonly amount: number | null;
  /** When the client cancelled, or when ops ruled on the no-show. */
  readonly at: string;
  /** When the visit was to start, which the notice is counted against. */
  readonly visit_started_at: string | null;
  /** How the client ended the visit; null on a no-show, where they ended nothing. */
  readonly change: "cancelled" | "moved" | null;
  /** Who attended and found nobody in; null on a late cancellation. */
  readonly technician: string | null;
}

export interface DayMoney extends DayFigures {
  readonly date: string;
  readonly charges: Charge[];
}

/**
 * The day's figures, in one statement. Each is over the rows themselves and
 * joins no person, so erasing a client moves none of them: what was taken on a
 * day stays what was taken, and only the named line beneath goes.
 */
const FIGURES = `SELECT
  (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE captured_at >= ?1 AND captured_at < ?2) AS collected,
  (SELECT COALESCE(SUM(amount), 0) FROM refunds
     WHERE status = 'created' AND created_at >= ?1 AND created_at < ?2) AS refunds_processing,
  (SELECT COALESCE(SUM(amount), 0) FROM refunds
     WHERE status = 'processed' AND processed_at >= ?1 AND processed_at < ?2) AS refunded,
  (SELECT COALESCE(SUM(kept_amount), 0) FROM visit_changes
     WHERE notice = 'late' AND kept_amount > 0 AND created_at >= ?1 AND created_at < ?2) AS charged,
  (SELECT COUNT(*) FROM no_show_cases
     WHERE decision = 'charged' AND decided_at >= ?1 AND decided_at < ?2) AS no_shows_charged`;

/**
 * Both kinds of charge in one statement. A payment kept under the 24-hour rule
 * is a visit_changes row with what it kept (migration 0020); a no-show is a
 * case ops ruled on, which carries a decision and no amount.
 *
 * A person who has been erased is left out of the lines, as they are left out of
 * board D2's tasks: their record is gone.
 */
const CHARGES = `SELECT * FROM (
  SELECT 'late_cancellation' AS kind, c.id AS id, pe.id AS person_id, pe.name AS person_name,
         c.kept_amount AS amount, c.created_at AS at, c.was_start AS visit_started_at,
         c.kind AS change, NULL AS technician
    FROM visit_changes c LEFT JOIN people pe ON pe.id = c.person_id
   WHERE c.notice = 'late' AND c.kept_amount > 0 AND (pe.id IS NULL OR pe.erased_at IS NULL)
     AND c.created_at >= ?1 AND c.created_at < ?2
  UNION ALL
  SELECT 'no_show', n.id, pe.id, pe.name, NULL, n.decided_at, a.window_start, NULL, t.name
    FROM no_show_cases n
    JOIN appointments a ON a.id = n.appointment_id
    JOIN checkins ci ON ci.id = n.checkin_id
    LEFT JOIN people pe ON pe.id = a.person_id
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'charged' AND (pe.id IS NULL OR pe.erased_at IS NULL)
     AND n.decided_at >= ?1 AND n.decided_at < ?2
) ORDER BY at LIMIT ?3`;

interface ChargeRow {
  kind: ChargeKind;
  id: string;
  person_id: string | null;
  person_name: string | null;
  amount: number | null;
  at: string;
  visit_started_at: string | null;
  change: "moved" | "replaced" | "cancelled" | null;
  technician: string | null;
}

/** The day's money and its charges, the earliest first. */
export async function dayMoney(db: D1Database, date: string, limit: number): Promise<DayMoney> {
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const [figures, charges] = await Promise.all([
    db.prepare(FIGURES).bind(from, to).first<DayFigures>(),
    db.prepare(CHARGES).bind(from, to, limit).all<ChargeRow>(),
  ]);

  return {
    date,
    collected: figures?.collected ?? 0,
    refunds_processing: figures?.refunds_processing ?? 0,
    refunded: figures?.refunded ?? 0,
    charged: figures?.charged ?? 0,
    no_shows_charged: figures?.no_shows_charged ?? 0,
    charges: charges.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
      amount: row.amount,
      at: row.at,
      visit_started_at: row.visit_started_at,
      // A visit replaced inside 24 hours was cancelled for a new one; the client ended this one either way.
      change: row.change === null ? null : row.change === "moved" ? "moved" : "cancelled",
      technician: row.technician,
    })),
  };
}
