// Blackout days: the days no visit is offered on, set by ops in Settings
// (visit_blackouts; docs/decisions/0088-every-policy-in-the-console.md).
//
// A day blacked out is offered to nobody and held for nobody, in the app or from
// the site (loadBlackouts, src/domain/occupancy.ts; docs/decisions/0068-a-paid-hold-is-kept.md).
// It moves no visit already booked on it: ops are told how many there are, and
// move them on the dispatch board. Each change is written in one batch with its
// audit entry (ADR 0031), which keeps the days, and each day the change replaced
// or took away with the Access identity that had set it. Never the reason: it is
// text ops type, and the log holds IDs, counts and codes only and is never
// blanked, so the reason lives in visit_blackouts alone.

import { addDays } from "../lib/india-time.ts";
import { auditStatement, type AuditActor } from "./audit.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../config/statuses.ts";

/** The most days one press blacks out: a month, so a typed year cannot close the diary. */
export const BLACKOUT_MAX_DAYS = 31;

interface Blackout {
  readonly date: string;
  readonly reason: string;
  /** Null for a day written by the runbook's SQL before the console had a screen for it. */
  readonly set_by: string | null;
  readonly set_at: string | null;
  /** Visits still booked on the day, which the blackout did not move. */
  readonly booked: number;
}

/**
 * Each blacked-out day from `today` on, with the visits still booked on it: those whose start falls on the day in
 * India, from its midnight (18:30 the day before in UTC) to the next.
 */
export async function blackoutsFrom(db: D1Database, today: string): Promise<Blackout[]> {
  const { results } = await db
    .prepare(
      `SELECT b.date, b.reason, b.set_by, b.set_at,
         (SELECT COUNT(*) FROM appointments a
          WHERE a.deleted_at IS NULL AND ${statusIn("a.status", VISIT_NOT_BEGUN)}
            AND a.window_start >= strftime('%Y-%m-%dT%H:%M:%fZ', b.date, '-330 minutes')
            AND a.window_start < strftime('%Y-%m-%dT%H:%M:%fZ', b.date, '+1 day', '-330 minutes')) AS booked
       FROM visit_blackouts b WHERE b.date >= ?1 ORDER BY b.date`,
    )
    .bind(today)
    .all<Blackout>();
  return results;
}

/** Every date from `from` to `to`, both ends included. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** Why a period was refused: the field that is wrong. */
type PeriodRefusal = "from" | "to";

/**
 * A period ops may offer again: from today on, and the right way round. Any length, since it only takes back days
 * already held, and the list runs held days together into one period.
 */
export function periodRefusal(period: { from: string; to: string }, today: string): PeriodRefusal | null {
  if (period.from < today) return "from";
  if (period.to < period.from) return "to";
  return null;
}

/**
 * A period ops may black out: as above, and a month at most. The length is judged by its last day before any day is
 * listed, so a year typed wrong costs nothing to refuse.
 */
export function additionRefusal(period: { from: string; to: string }, today: string): PeriodRefusal | null {
  const refused = periodRefusal(period, today);
  if (refused !== null) return refused;
  return period.to > addDays(period.from, BLACKOUT_MAX_DAYS - 1) ? "to" : null;
}

/** A day as the audit log keeps it, once a change has replaced or taken it away: the day, and who had set it. */
interface HeldDay {
  readonly date: string;
  readonly set_by: string | null;
}

const heldBetween = async (db: D1Database, from: string, to: string): Promise<HeldDay[]> =>
  (
    await db
      .prepare("SELECT date, set_by FROM visit_blackouts WHERE date BETWEEN ?1 AND ?2 ORDER BY date")
      .bind(from, to)
      .all<HeldDay>()
  ).results;

interface Change {
  readonly from: string;
  readonly to: string;
  readonly actor: AuditActor;
  readonly requestId: string;
  readonly now: Date;
}

/**
 * Blacks out every day from `from` to `to`. A day already blacked out takes the reason given now, and the audit entry
 * names it and who had set it. The period has passed additionRefusal.
 */
export async function addBlackouts(db: D1Database, change: Change & { readonly reason: string }): Promise<void> {
  const dates = datesBetween(change.from, change.to);
  const replaced = await heldBetween(db, change.from, change.to);
  const at = change.now.toISOString();
  await db.batch([
    ...dates.map((date) =>
      db
        .prepare(
          `INSERT INTO visit_blackouts (date, reason, set_by, set_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (date) DO UPDATE SET reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at`,
        )
        .bind(date, change.reason, change.actor.id, at),
    ),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "blackout.add",
        subject: { kind: "blackout", id: change.from },
        requestId: change.requestId,
        detail: { from: change.from, to: change.to, days: dates.length, replaced: JSON.stringify(replaced) },
      },
      change.now,
    ),
  ]);
}

/**
 * Offers the blacked-out days from `from` to `to` again. "not_found" when none of them is blacked out, and then
 * nothing is recorded. The audit entry names each day taken away and who had set it. The period has passed
 * periodRefusal.
 */
export async function removeBlackouts(db: D1Database, change: Change): Promise<"removed" | "not_found"> {
  const removed = await heldBetween(db, change.from, change.to);
  if (removed.length === 0) return "not_found";
  await db.batch([
    db.prepare("DELETE FROM visit_blackouts WHERE date BETWEEN ?1 AND ?2").bind(change.from, change.to),
    auditStatement(
      db,
      {
        surface: "ops",
        actor: change.actor,
        action: "blackout.remove",
        subject: { kind: "blackout", id: change.from },
        requestId: change.requestId,
        detail: { from: change.from, to: change.to, days: removed.length, removed: JSON.stringify(removed) },
      },
      change.now,
    ),
  ]);
  return "removed";
}
