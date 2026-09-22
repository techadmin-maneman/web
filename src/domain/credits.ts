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
