// Service-visit credits (docs/decisions/0033-credit-ledger.md): the ledger is append-only, and a balance is
// always summed from it. A grant adds visits that expire together. Each redeem, restore, expire or clawback
// names the grant it draws on, so credits are spent oldest grant first, and a grant's remaining visits are
// its own plus everything drawn on it.

import { creditExpiry } from "../policy/referral-reward.ts";

export type CreditSource = "referral" | "appointment" | "ops" | "import";

export interface Balance {
  /** Unexpired service visits left. */
  readonly visits: number;
  /** When the soonest of them expires. */
  readonly earliestExpiry: string | null;
}

interface GrantRow {
  id: string;
  expires_at: string | null;
  remaining: number;
}

/** The person's grants still in date, with what each has left, soonest to expire first. */
async function liveGrants(db: D1Database, personId: string, now: Date): Promise<GrantRow[]> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.expires_at,
         g.visits + COALESCE((SELECT SUM(e.visits) FROM credit_ledger e WHERE e.grant_id = g.id), 0) AS remaining
       FROM credit_ledger g
       WHERE g.person_id = ?1 AND g.kind = 'grant' AND (g.expires_at IS NULL OR g.expires_at > ?2)
       ORDER BY g.expires_at IS NULL, g.expires_at, g.created_at`,
    )
    .bind(personId, now.toISOString())
    .all<GrantRow>();
  return results.filter((grant) => grant.remaining > 0);
}

export async function creditBalance(db: D1Database, personId: string, now: Date): Promise<Balance> {
  const grants = await liveGrants(db, personId, now);
  return {
    visits: grants.reduce((sum, grant) => sum + grant.remaining, 0),
    earliestExpiry: grants[0]?.expires_at ?? null,
  };
}

/** A grant of visits from a source, which a repeat of the same source cannot grant again. */
export function grantCredits(
  db: D1Database,
  input: { personId: string; visits: number; source: CreditSource; sourceId: string; now: Date; expiresAt?: Date },
): D1PreparedStatement {
  const expiresAt = input.expiresAt ?? creditExpiry(input.now);
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, expires_at, created_at)
       VALUES (?1, ?2, 'grant', ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      input.personId,
      input.visits,
      input.source,
      input.sourceId,
      expiresAt.toISOString(),
      input.now.toISOString(),
    );
}

/** One credit, from the grant that expires soonest, for a visit; null if the person has none left. */
export async function redeemCredit(
  db: D1Database,
  personId: string,
  appointmentId: string,
  now: Date,
): Promise<D1PreparedStatement | null> {
  const [grant] = await liveGrants(db, personId, now);
  if (grant === undefined) return null;
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       VALUES (?1, ?2, 'redeem', -1, ?3, 'appointment', ?4, ?5)`,
    )
    .bind(crypto.randomUUID(), personId, grant.id, appointmentId, now.toISOString());
}

/** How many expired grants a pass closes. */
const EXPIRE_PER_PASS = 20;

/**
 * Closes grants past their expiry: an expire entry takes whatever is left, or marks a spent one closed, so each
 * grant is expired once. The balance already leaves them out; this keeps the ledger's own record.
 */
export async function expireCredits(db: D1Database, now: Date): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.person_id, g.source_kind, g.source_id,
         g.visits + COALESCE((SELECT SUM(e.visits) FROM credit_ledger e WHERE e.grant_id = g.id), 0) AS remaining
       FROM credit_ledger g
       WHERE g.kind = 'grant' AND g.expires_at <= ?1
         AND NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.grant_id = g.id AND x.kind = 'expire')
       LIMIT ?2`,
    )
    .bind(now.toISOString(), EXPIRE_PER_PASS)
    .all<{ id: string; person_id: string; source_kind: CreditSource; source_id: string; remaining: number }>();
  if (results.length === 0) return 0;
  await db.batch(
    results.map((grant) =>
      db
        .prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           VALUES (?1, ?2, 'expire', ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(
          crypto.randomUUID(),
          grant.person_id,
          -Math.max(0, grant.remaining),
          grant.id,
          grant.source_kind,
          grant.source_id,
          now.toISOString(),
        ),
    ),
  );
  return results.length;
}

/** Takes back what is left of a source's grants: a referral whose first fit was refunded under the guarantee. */
export async function clawBack(db: D1Database, source: CreditSource, sourceId: string, now: Date): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.person_id,
         g.visits + COALESCE((SELECT SUM(e.visits) FROM credit_ledger e WHERE e.grant_id = g.id), 0) AS remaining
       FROM credit_ledger g WHERE g.kind = 'grant' AND g.source_kind = ?1 AND g.source_id = ?2`,
    )
    .bind(source, sourceId)
    .all<{ id: string; person_id: string; remaining: number }>();
  const live = results.filter((grant) => grant.remaining > 0);
  if (live.length === 0) return;
  await db.batch(
    live.map((grant) =>
      db
        .prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           VALUES (?1, ?2, 'clawback', ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(crypto.randomUUID(), grant.person_id, -grant.remaining, grant.id, source, sourceId, now.toISOString()),
    ),
  );
}
