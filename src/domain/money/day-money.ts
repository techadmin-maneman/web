// A day's money, as the console's Payments page shows it: what was collected, what went back, and
// each charge that was kept or ruled on. Derived from the rows Razorpay's
// webhook and the visit changes already write, the way the Tasks board is
// derived (src/domain/ops/tasks.ts); no total is accumulated anywhere, so none can
// drift from the payments behind it.
//
// Every amount is in paise, as migration 0014 keeps them. Razorpay is the
// record of what was paid and refunded (docs/decisions/0044-payments-mirror.md),
// so a payment counts as collected from the moment its capture reached us, and
// a refund from the moment Razorpay reported it processed.

import { addDays, indiaInstant } from "../../lib/india-time.ts";
import type { PlacesReached } from "../../policy/access.ts";
import { reachBinding, withinReach } from "../clients/places.ts";

/** The board's three figures, and what the third leaves out. */
interface DayFigures {
  /** In paise, captured on the day: the board's "Collected today". */
  readonly collected: number;
  /** In paise, asked for on the day and not back with the client yet: "Refunds processing". */
  readonly refunds_processing: number;
  /** In paise, processed by Razorpay on the day, which the board draws no figure of its own for. */
  readonly refunded: number;
  /**
   * In paise, kept from the client on the day: "Charges and no-shows", the late
   * cancellations and the no-shows ops charged, each by what it kept
   * (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
   */
  readonly charged: number;
}

type ChargeKind = "late_cancellation" | "no_show";

/** One line of "No-shows and late cancellations": who it was, what it was, and the evidence for it. */
interface Charge {
  readonly id: string;
  readonly kind: ChargeKind;
  /** Null for a visit with no client of ours. */
  readonly person: { readonly id: string; readonly name: string } | null;
  /** In paise, what was kept; null on a no-show charged before a charge recorded what it kept. */
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

interface DayMoney extends DayFigures {
  readonly date: string;
  readonly charges: Charge[];
}

/**
 * The day's figures in the places reached, in one statement. Each is over the
 * rows themselves and joins no person, so erasing a client moves none of the
 * national figures: what was taken on a day stays what was taken, and only the
 * named line beneath goes.
 */
const FIGURES = `SELECT
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
     WHERE p.captured_at >= ?1 AND p.captured_at < ?2 AND ${withinReach("payment", "p", "?3")}) AS collected,
  (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
     WHERE r.status = 'created' AND r.created_at >= ?1 AND r.created_at < ?2
       AND ${withinReach("refund", "r", "?3")}) AS refunds_processing,
  (SELECT COALESCE(SUM(r.amount), 0) FROM refunds r
     WHERE r.status = 'processed' AND r.processed_at >= ?1 AND r.processed_at < ?2
       AND ${withinReach("refund", "r", "?3")}) AS refunded,
  (SELECT COALESCE(SUM(c.kept_amount), 0) FROM visit_changes c
     WHERE c.notice = 'late' AND c.kept_amount > 0 AND c.created_at >= ?1 AND c.created_at < ?2
       AND ${withinReach("visit_change", "c", "?3")})
  + (SELECT COALESCE(SUM(n.kept_amount), 0) FROM no_show_cases n
     WHERE n.decision = 'charged' AND n.decided_at >= ?1 AND n.decided_at < ?2
       AND ${withinReach("no_show", "n", "?3")}) AS charged`;

/**
 * Both kinds of charge in one statement, each that kept money: a payment kept
 * under the 24-hour rule is a visit_changes row with what it kept (migration
 * 0020); a no-show is a case ops charged, with what the charge kept (migration
 * 0059). One charged before that recorded nothing is listed with no amount.
 *
 * A person who has been erased is left out of the lines, as they are left out of
 * the Tasks board: their record is gone.
 */
const CHARGES = `SELECT * FROM (
  SELECT 'late_cancellation' AS kind, c.id AS id, pe.id AS person_id, pe.name AS person_name,
         c.kept_amount AS amount, c.created_at AS at, c.was_start AS visit_started_at,
         c.kind AS change, NULL AS technician
    FROM visit_changes c LEFT JOIN people pe ON pe.id = c.person_id
   WHERE c.notice = 'late' AND c.kept_amount > 0 AND (pe.id IS NULL OR pe.erased_at IS NULL)
     AND c.created_at >= ?1 AND c.created_at < ?2 AND ${withinReach("visit_change", "c", "?4")}
  UNION ALL
  SELECT 'no_show', n.id, pe.id, pe.name, n.kept_amount, n.decided_at, a.window_start, NULL, t.name
    FROM no_show_cases n
    JOIN appointments a ON a.id = n.appointment_id
    JOIN checkins ci ON ci.id = n.checkin_id
    LEFT JOIN people pe ON pe.id = a.person_id
    LEFT JOIN technicians t ON t.id = ci.technician_id
   WHERE n.decision = 'charged' AND (n.kept_amount IS NULL OR n.kept_amount > 0)
     AND (pe.id IS NULL OR pe.erased_at IS NULL)
     AND n.decided_at >= ?1 AND n.decided_at < ?2 AND ${withinReach("no_show", "n", "?4")}
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

/** A visit replaced inside 24 hours was cancelled for a new one; the client ended it either way. */
function changeOf(change: ChargeRow["change"]): Charge["change"] {
  if (change === null) return null;
  return change === "moved" ? "moved" : "cancelled";
}

/** The day's money in the places reached, and its charges, the earliest first. */
export async function dayMoney(db: D1Database, date: string, limit: number, reached: PlacesReached): Promise<DayMoney> {
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const cities = reachBinding(reached);
  const [figures, charges] = await Promise.all([
    db.prepare(FIGURES).bind(from, to, cities).first<DayFigures>(),
    db.prepare(CHARGES).bind(from, to, limit, cities).all<ChargeRow>(),
  ]);

  return {
    date,
    collected: figures?.collected ?? 0,
    refunds_processing: figures?.refunds_processing ?? 0,
    refunded: figures?.refunded ?? 0,
    charged: figures?.charged ?? 0,
    charges: charges.results.map((row) => ({
      id: row.id,
      kind: row.kind,
      person: row.person_id === null || row.person_name === null ? null : { id: row.person_id, name: row.person_name },
      amount: row.amount,
      at: row.at,
      visit_started_at: row.visit_started_at,
      change: changeOf(row.change),
      technician: row.technician,
    })),
  };
}
