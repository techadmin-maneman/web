// A ruling made once, a no-show's or a dispute's, and what its batch writes beside it
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
//
// The ruling's update writes this request's ruling ID where no ruling is yet. Its audit entry
// (auditStatementIfRuled, src/domain/platform/audit.ts), the client's message and a credit given back are written only where
// the row carries that ID, so a ruling that loses a race to another member of staff's writes nothing, and the ruling
// and all it writes happen in one batch, or none of them does.

import { restoreRedeemedIf } from "../money/credits.ts";
import type { RulingClaim } from "../platform/audit.ts";

export type { RulingClaim };

/**
 * A message about a ruling made once, to go in the ruling's batch: written only if it is this request's ruling, so
 * a ruling that lost a race to another member of staff's tells the client nothing.
 */
export function rulingMessage(
  db: D1Database,
  input: { personId: string; appointmentId: string; kind: "no_show_decided" | "no_show_dispute_ruled"; now: Date },
  ruled: RulingClaim,
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       SELECT ?1, ?2, ?3, ?4, 'appointment', ?5, 'queued', ?2
       WHERE EXISTS (SELECT 1 FROM ${ruled.table} WHERE id = ?6 AND ruling_id = ?7)`,
    )
    .bind(id, input.now.toISOString(), input.personId, input.kind, input.appointmentId, ruled.id, ruled.rulingId);
  return { id, statement };
}

/**
 * The credit a visit used, back in its grant, for the ruling this request made: once (the ledger's one-use index),
 * and only to a grant that can still take it, neither clawed back nor expired, as a free cancel's is
 * (src/policy/moving-a-visit.ts).
 */
export function creditBack(db: D1Database, appointmentId: string, now: Date, ruled: RulingClaim): D1PreparedStatement {
  return restoreRedeemedIf(db, appointmentId, now, {
    sql: `EXISTS (SELECT 1 FROM ${ruled.table} WHERE id = ?1 AND ruling_id = ?2)`,
    values: [ruled.id, ruled.rulingId],
  });
}

/**
 * What the ruling this request made gives back of the visit's payment, kept as owed in its batch, so a request that
 * stops after the commit leaves it for the cron's refund job (src/domain/no-shows/after-a-ruling.ts).
 */
export function refundOwed(
  db: D1Database,
  owed: { readonly appointmentId: string; readonly why: string; readonly amount: number; readonly now: Date },
  ruled: RulingClaim,
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO no_show_refunds (id, appointment_id, why, amount, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (SELECT 1 FROM ${ruled.table} WHERE id = ?6 AND ruling_id = ?7)
       ON CONFLICT DO NOTHING`,
    )
    .bind(id, owed.appointmentId, owed.why, owed.amount, owed.now.toISOString(), ruled.id, ruled.rulingId);
  return { id, statement };
}
