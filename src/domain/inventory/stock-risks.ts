// Stock at risk (docs/decisions/0178-stock-at-risk.md): each hour, the fits booked in the weeks ahead that the stock
// demand finds at risk (./stock-demand.ts) are kept, each once, as a task on the board; one no longer at risk, its
// hair system now held in its city, its profile matched, or the visit moved or called off, is cleared. Nothing is
// blocked: the booking stands, and ops have the days before it to put the stock right.

import { fitsAtRisk } from "../purchasing/stock-demand.ts";

/**
 * The open risks, as the Tasks board reads its rows (src/domain/ops/tasks.ts): only of a visit still to come, so one
 * fitted, moved off the books or called off leaves the board at once, before the hour's refresh clears it.
 */
export const STOCK_RISKS_OPEN = `SELECT 'stock_at_risk' AS "group", r.appointment_id AS id, a.person_id AS person_id,
    pe.name AS person_name, COALESCE(r.consumable_code, '') AS detail,
    json_object('consumable_code', r.consumable_code) AS facts, r.found_at AS since,
    a.window_start AS due_by, '' AS episode
  FROM stock_risks r INDEXED BY stock_risks_open
  JOIN appointments a ON a.id = r.appointment_id LEFT JOIN people pe ON pe.id = a.person_id
  WHERE r.cleared_at IS NULL AND a.deleted_at IS NULL AND a.status IN ('scheduled', 'dispatched')
    AND (pe.id IS NULL OR pe.erased_at IS NULL)`;

/** The fits at risk today kept, each once, and those no longer at risk cleared. How many are open now. */
export async function refreshStockRisks(db: D1Database, today: string, now: Date, demandDays: number): Promise<number> {
  const atRisk = await fitsAtRisk(db, today, demandDays);
  const at = now.toISOString();
  const open = JSON.stringify(atRisk.map((fit) => fit.appointmentId));
  await db.batch([
    ...atRisk.map((fit) =>
      db
        .prepare(
          `INSERT INTO stock_risks (appointment_id, consumable_code, city, found_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (appointment_id) DO UPDATE SET consumable_code = excluded.consumable_code, city = excluded.city,
             cleared_at = NULL, found_at = CASE WHEN stock_risks.cleared_at IS NULL THEN stock_risks.found_at ELSE excluded.found_at END`,
        )
        .bind(fit.appointmentId, fit.code, fit.city, at),
    ),
    db
      .prepare(
        `UPDATE stock_risks SET cleared_at = ?1
         WHERE cleared_at IS NULL AND appointment_id NOT IN (SELECT value FROM json_each(?2))`,
      )
      .bind(at, open),
  ]);
  return atRisk.length;
}
