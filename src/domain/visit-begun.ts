// Whether a visit has begun, by the technician's steps rather than the visit's status. The SQL fragments read the appointments row the alias names.

/**
 * True once the visit has begun: the technician's phone has landed a check-in, a start or an outcome for it, a one
 * visit was closed as fitted or declined, or its payment link was paid.
 */
export function visitBegun(alias: string): string {
  return begunBy(alias, "'check_in', 'start', 'outcome'");
}

/** True once the visit has begun by more than the technician's check-in: he has started or closed it, or it was paid. */
export function begunPastArrival(alias: string): string {
  return begunBy(alias, "'start', 'outcome'");
}

function begunBy(alias: string, stepKinds: string): string {
  return `(EXISTS (SELECT 1 FROM job_events je WHERE je.appointment_id = ${alias}.id AND je.superseded = 0
      AND je.kind IN (${stepKinds}))
    OR COALESCE(${alias}.one_visit, '') IN ('fitted', 'declined')
    OR EXISTS (SELECT 1 FROM payment_links pl WHERE pl.appointment_id = ${alias}.id AND pl.paid_at IS NOT NULL))`;
}

/** The outcome the technician's phone last landed for the visit: done, partial or no_show; NULL before one lands. */
export function landedOutcome(alias: string): string {
  return `(SELECT json_extract(je.body, '$.outcome') FROM job_events je
    WHERE je.appointment_id = ${alias}.id AND je.kind = 'outcome' AND je.superseded = 0
    ORDER BY je.received_at DESC, je.rowid DESC LIMIT 1)`;
}

export async function hasBegun(db: D1Database, appointmentId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM appointments a WHERE a.id = ?1 AND ${visitBegun("a")}`)
    .bind(appointmentId)
    .first();
  return row !== null;
}
