// A client's contact change still owed to their CRM lead (docs/decisions/0203-a-vendor-down-is-held-off.md): kept in D1
// as the change is made, so a message the queue loses, or one tried while the CRM is down, is sent again by the
// sweeper, and gone once the lead has it. One row a client: a later change is in the one already owed.

/** What the lead is owed: the latest change, and whether ops attached an invite, which the update notes on the lead. */
export interface OwedUpdate {
  readonly changedAt: string;
  readonly inviteAttached: boolean;
}

/** The change owed from now, or from when an earlier one still owed was made, with an invite once one is attached. */
export function oweContactUpdate(
  db: D1Database,
  owed: { readonly personId: string; readonly inviteAttached: boolean; readonly now: Date },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO crm_contact_updates (person_id, owed_since, changed_at, invite_attached) VALUES (?1, ?2, ?2, ?3)
       ON CONFLICT (person_id) DO UPDATE SET changed_at = excluded.changed_at, tried_at = NULL,
         invite_attached = MAX(invite_attached, excluded.invite_attached)`,
    )
    .bind(owed.personId, owed.now.toISOString(), owed.inviteAttached ? 1 : 0);
}

export async function owedUpdate(db: D1Database, personId: string): Promise<OwedUpdate | null> {
  const row = await db
    .prepare("SELECT changed_at, invite_attached FROM crm_contact_updates WHERE person_id = ?1")
    .bind(personId)
    .first<{ changed_at: string; invite_attached: number }>();
  return row === null ? null : { changedAt: row.changed_at, inviteAttached: row.invite_attached === 1 };
}

/** The lead has what was owed as it was read: a change, or an invite, made since stays owed. */
export function contactUpdateSent(db: D1Database, personId: string, sent: OwedUpdate): D1PreparedStatement {
  return db
    .prepare("DELETE FROM crm_contact_updates WHERE person_id = ?1 AND changed_at <= ?2 AND invite_attached <= ?3")
    .bind(personId, sent.changedAt, sent.inviteAttached ? 1 : 0);
}

/** A try that did not reach the lead: the sweeper sends it again once a while has passed since. */
export function contactUpdateTried(db: D1Database, personId: string, now: Date): D1PreparedStatement {
  return db
    .prepare("UPDATE crm_contact_updates SET attempts = attempts + 1, tried_at = ?2 WHERE person_id = ?1")
    .bind(personId, now.toISOString());
}

/** Owed updates the sweeper sends again: neither tried nor changed for a while. */
export async function staleContactUpdates(
  db: D1Database,
  window: { readonly before: string; readonly limit: number },
): Promise<{ readonly personId: string; readonly inviteAttached: boolean }[]> {
  const { results } = await db
    .prepare(
      `SELECT person_id, invite_attached FROM crm_contact_updates INDEXED BY crm_contact_updates_due
       WHERE COALESCE(tried_at, changed_at) < ?1 ORDER BY COALESCE(tried_at, changed_at) LIMIT ?2`,
    )
    .bind(window.before, window.limit)
    .all<{ person_id: string; invite_attached: number }>();
  return results.map((row) => ({ personId: row.person_id, inviteAttached: row.invite_attached === 1 }));
}
