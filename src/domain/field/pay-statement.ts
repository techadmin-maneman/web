// What each technician earned in a month at their rates per visit (docs/decisions/0122-technician-pay-per-visit.md):
// every visit they closed in it, by kind and city, at the rate in force on the visit's day in India, as payroll will
// read it. A city's rate stands in for every city's there, and a city's rate of none falls back to every city's. A
// visit with no rate at all still counts, at none, so the gap shows.

import { indiaDateSql, indiaInstant } from "../../lib/india-time.ts";
import type { VISIT_PAY_KINDS } from "./technician-pay.ts";

type VisitPayKind = (typeof VISIT_PAY_KINDS)[number];

/** One technician's visits of one kind in one city at one rate. */
export interface PayLine {
  readonly technician_id: string;
  readonly technician: string;
  readonly city: string | null;
  readonly kind: VisitPayKind;
  readonly visits: number;
  /** Paise a visit; null where no rate was in force. */
  readonly rate: number | null;
  /** Paise in all; null where no rate was in force. */
  readonly amount: number | null;
}

/**
 * Each visit closed in the month, as payroll counts it: a client not home is a no-show whatever was booked, and a
 * consultation and fit in one visit that ended in a fit is one visit; the rate is the grade's on the visit's day.
 */
const STATEMENT = `WITH closed AS (
  SELECT a.technician_id, t.name AS technician, t.pay_grade_id, a.service_city AS city,
    ${indiaDateSql("a.window_start")} AS day,
    CASE WHEN o.outcome = 'no_show' THEN 'no_show'
         WHEN a.one_visit IS NOT NULL AND a.type = 'first_fit' THEN 'one_visit'
         ELSE a.type END AS kind
  FROM appointments a JOIN visit_outcomes o ON o.appointment_id = a.id JOIN technicians t ON t.id = a.technician_id
  WHERE a.window_start >= ?1 AND a.window_start < ?2 AND a.deleted_at IS NULL AND t.test_record = 0
    AND (?3 IS NULL OR a.technician_id = ?3)
), priced AS (
  SELECT c.*, COALESCE(
    (SELECT r.amount FROM visit_pay_rates r WHERE r.grade_id = c.pay_grade_id AND r.visit_kind = c.kind
       AND r.city = c.city AND r.effective_from <= c.day ORDER BY r.effective_from DESC LIMIT 1),
    (SELECT r.amount FROM visit_pay_rates r WHERE r.grade_id = c.pay_grade_id AND r.visit_kind = c.kind
       AND r.city IS NULL AND r.effective_from <= c.day ORDER BY r.effective_from DESC LIMIT 1)) AS rate
  FROM closed c
)
SELECT technician_id, technician, city, kind, COUNT(*) AS visits, rate, rate * COUNT(*) AS amount
FROM priced GROUP BY technician_id, technician, city, kind, rate
ORDER BY technician, technician_id, city, kind, rate`;

/** `month` is India's, as YYYY-MM; every technician's, or the one named. */
export async function payStatement(
  db: D1Database,
  month: string,
  technicianId: string | null = null,
): Promise<PayLine[]> {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const next = number === 12 ? `${String(year + 1)}-01` : `${String(year)}-${String(number + 1).padStart(2, "0")}`;
  const { results } = await db
    .prepare(STATEMENT)
    .bind(
      indiaInstant(`${month}-01`, "00:00").toISOString(),
      indiaInstant(`${next}-01`, "00:00").toISOString(),
      technicianId,
    )
    .all<PayLine>();
  return results;
}
