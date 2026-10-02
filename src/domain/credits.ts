// Service-visit credits (docs/decisions/0033-credit-ledger.md): the ledger is append-only, and a balance is
// always summed from it. A grant adds visits that expire together. Each redeem, restore, expire, clawback or
// adjust names the grant it draws on, so credits are spent oldest grant first, and a grant's remaining visits
// are its own plus everything drawn on it. Ops put a balance right by hand with adjustCredits.

import { creditExpiry } from "../policy/referral-reward.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { DAY_MS } from "../lib/durations.ts";

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

/** SQL for the person's grants still in date, with what each has left; its arguments are placeholders. */
const liveGrantsSql = (personId: string, now: string) =>
  `SELECT g.id, g.expires_at,
     g.visits + COALESCE((SELECT SUM(e.visits) FROM credit_ledger e WHERE e.grant_id = g.id), 0) AS remaining
   FROM credit_ledger g
   WHERE g.person_id = ${personId} AND g.kind = 'grant' AND (g.expires_at IS NULL OR g.expires_at > ${now})`;

/**
 * A credit hold confirmed and on its way to FSM: its credit is redeemed once FSM books the visit, so until then no
 * other booking may count on it.
 */
const PROMISED_CREDIT = "use_credit = 1 AND state = 'held' AND confirmed_at IS NOT NULL";

/** The person's grants still in date, with what each has left, soonest to expire first. */
async function liveGrants(db: D1Database, personId: string, now: Date): Promise<GrantRow[]> {
  const { results } = await db
    .prepare(`${liveGrantsSql("?1", "?2")} ORDER BY g.expires_at IS NULL, g.expires_at, g.created_at`)
    .bind(personId, now.toISOString())
    .all<GrantRow>();
  return results.filter((grant) => grant.remaining > 0);
}

const balanceOf = (grants: readonly GrantRow[]): Balance => ({
  visits: grants.reduce((sum, grant) => sum + grant.remaining, 0),
  earliestExpiry: grants[0]?.expires_at ?? null,
});

/** What the ledger holds for the person. Ops see this; a booking counts on spendableCredits. */
export async function creditBalance(db: D1Database, personId: string, now: Date): Promise<Balance> {
  return balanceOf(await liveGrants(db, personId, now));
}

/**
 * What the person may still spend: their balance, less the credits their confirmed bookings on the way to FSM will
 * redeem, other than `exceptHoldId`'s. Those are taken from the grants that expire soonest, as a redeem takes them.
 */
export async function spendableCredits(
  db: D1Database,
  personId: string,
  now: Date,
  exceptHoldId: string | null = null,
): Promise<Balance> {
  const [grants, promised] = await Promise.all([
    liveGrants(db, personId, now),
    db
      .prepare(`SELECT COUNT(*) AS holds FROM slot_holds WHERE person_id = ?1 AND ${PROMISED_CREDIT} AND id IS NOT ?2`)
      .bind(personId, exceptHoldId)
      .first<{ holds: number }>(),
  ]);
  return balanceOf(withoutPromised(grants, promised?.holds ?? 0));
}

/** The grants with `promised` visits taken from them, soonest to expire first, leaving out any with nothing left. */
function withoutPromised(grants: readonly GrantRow[], promised: number): GrantRow[] {
  let toTake = promised;
  const left: GrantRow[] = [];
  for (const grant of grants) {
    const taken = Math.min(toTake, grant.remaining);
    toTake -= taken;
    if (grant.remaining > taken) left.push({ ...grant, remaining: grant.remaining - taken });
  }
  return left;
}

/** spendableCredits as SQL, for a statement that decides on it as it writes; its arguments are placeholders. */
export const spendableCreditsSql = (personId: string, now: string, exceptHoldId: string): string =>
  `((SELECT COALESCE(SUM(remaining), 0) FROM (${liveGrantsSql(personId, now)}) WHERE remaining > 0)
    - (SELECT COUNT(*) FROM slot_holds WHERE person_id = ${personId} AND ${PROMISED_CREDIT} AND id IS NOT ${exceptHoldId}))`;

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

/**
 * One credit, from the grant that expires soonest, for a visit; null if the person has none left. A visit
 * redeems once: asked again, it writes nothing (credit_ledger_one_use).
 */
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
       VALUES (?1, ?2, 'redeem', -1, ?3, 'appointment', ?4, ?5) ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), personId, grant.id, appointmentId, now.toISOString());
}

/**
 * redeemCredit for the visit a booking is booked as, for the batch that books it, placed after the statement that
 * does: it writes nothing if that statement booked nothing.
 */
export async function redeemCreditForBooking(
  db: D1Database,
  booking: { readonly holdId: string; readonly personId: string },
  now: Date,
): Promise<D1PreparedStatement | null> {
  const [grant] = await liveGrants(db, booking.personId, now);
  if (grant === undefined) return null;
  // The WHERE clause also keeps SQLite from reading ON CONFLICT as a join's ON.
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
       SELECT ?1, ?2, 'redeem', -1, ?3, 'appointment', appointment_id, ?5
       FROM slot_holds WHERE id = ?4 AND state = 'booked' AND appointment_id IS NOT NULL
       ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), booking.personId, grant.id, booking.holdId, now.toISOString());
}

/** Why ops put a balance right by hand: a credit given or taken in error, or visits given to make up for something. */
export const ADJUST_REASONS = ["correction", "goodwill"] as const;

/**
 * Ops putting a balance right by hand, with the audit entry in the same batch: a change that is not recorded
 * does not happen (ADR 0031). Visits added are a grant from ops, which expires as any grant does; visits taken
 * away are adjust entries drawn on the live grants, soonest to expire first. Null, and nothing written, when
 * more are taken away than the person has.
 */
export async function adjustCredits(
  db: D1Database,
  input: { personId: string; visits: number; audit: AuditEntry; now: Date },
): Promise<Balance | null> {
  const { personId, visits, now } = input;
  const adjustmentId = crypto.randomUUID();
  const changes =
    visits > 0
      ? [grantCredits(db, { personId, visits, source: "ops", sourceId: adjustmentId, now })]
      : await takeAway(db, { personId, visits: -visits, adjustmentId, now });
  if (changes === null) return null;
  await db.batch([...changes, auditStatement(db, input.audit, now)]);
  return creditBalance(db, personId, now);
}

/** The adjust entries that take visits away, oldest-expiring grant first; null if the grants hold too few. */
async function takeAway(
  db: D1Database,
  input: { personId: string; visits: number; adjustmentId: string; now: Date },
): Promise<D1PreparedStatement[] | null> {
  const statements: D1PreparedStatement[] = [];
  let left = input.visits;
  for (const grant of await liveGrants(db, input.personId, input.now)) {
    if (left === 0) break;
    const taken = Math.min(left, grant.remaining);
    left -= taken;
    statements.push(
      db
        .prepare(
          `INSERT INTO credit_ledger (id, person_id, kind, visits, grant_id, source_kind, source_id, created_at)
           VALUES (?1, ?2, 'adjust', ?3, ?4, 'ops', ?5, ?6)`,
        )
        .bind(crypto.randomUUID(), input.personId, -taken, grant.id, input.adjustmentId, input.now.toISOString()),
    );
  }
  return left === 0 ? statements : null;
}

/** How many expired grants a pass closes. */
const EXPIRE_PER_PASS = 20;
/**
 * How far back a pass looks for a grant to close. Every grant that ever expired would otherwise be read again on
 * every five-minute run; a week covers any outage the cron is likely to have.
 */
const EXPIRE_LOOKBACK_MS = 7 * DAY_MS;

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
       WHERE g.kind = 'grant' AND g.expires_at <= ?1 AND g.expires_at > ?3
         AND NOT EXISTS (SELECT 1 FROM credit_ledger x WHERE x.grant_id = g.id AND x.kind = 'expire')
       LIMIT ?2`,
    )
    .bind(now.toISOString(), EXPIRE_PER_PASS, new Date(now.getTime() - EXPIRE_LOOKBACK_MS).toISOString())
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
