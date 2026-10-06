// A ruling made once, a no-show's or a dispute's, and what its batch writes beside it
// (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
//
// The ruling's update writes this request's ruling ID where no ruling is yet. Its audit entry
// (auditStatementIfRuled, src/domain/ops/audit.ts), the client's message and a credit given back are written only where
// the row carries that ID, so a ruling that loses a race to another member of staff's writes nothing, and the ruling
// and all it writes happen in one batch, or none of them does.

/** A ruling made once, as this request made it: the row it ruled on, and the ruling ID it wrote there. */
export interface RulingClaim {
  readonly table: "no_show_cases" | "no_show_disputes";
  readonly id: string;
  readonly rulingId: string;
}

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
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       SELECT ?1, r.person_id, 'restore', 1, r.grant_id, 'appointment', r.source_id, ?3
       FROM credit_ledger r JOIN credit_ledger g ON g.id = r.grant_id
       WHERE r.kind = 'redeem' AND r.source_id = ?2
         AND NOT EXISTS (SELECT 1 FROM credit_ledger c WHERE c.grant_id = r.grant_id AND c.kind = 'clawback')
         AND (g.expires_at IS NULL OR g.expires_at > ?3)
         AND EXISTS (SELECT 1 FROM ${ruled.table} WHERE id = ?4 AND ruling_id = ?5)
       ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), appointmentId, now.toISOString(), ruled.id, ruled.rulingId);
}
