// A technician's suggestion for finishing a visit they left partly done, or could not fit
// (docs/decisions/0246-closed-and-sent-back.md): kept on the visit's outcome, where ops read it on its task. A later
// suggestion takes the place of the one before.

import type { FinishAsk } from "../../policy/finish-the-work.ts";

/** Keeps the suggestion on a visit closed partly done; false for a visit not closed so. */
export async function askToFinish(
  db: D1Database,
  input: { appointmentId: string; ask: FinishAsk; now: Date },
): Promise<boolean> {
  const row = await db
    .prepare(
      `UPDATE visit_outcomes SET finish_ask = ?2, finish_asked_at = ?3
        WHERE appointment_id = ?1 AND outcome = 'partial' AND COALESCE(partial_reason, '') <> 'no_show'
        RETURNING appointment_id`,
    )
    .bind(input.appointmentId, input.ask, input.now.toISOString())
    .first();
  return row !== null;
}
