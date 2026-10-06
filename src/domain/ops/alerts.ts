// Alerts kept in D1 (migration 0038), so that a failure which needs a person
// reaches one once, with the IDs to act on and a link into the ops console
// (docs/decisions/0067-alerts-and-silent-failures.md).
//
// An alert is raised under a key naming what went wrong and to what:
// "books_refund_refused:<refundId>". Raising it again only counts it. The chat
// hears of it the first time, and again while it stays open: when it has
// happened 10, 100 and 1,000 times as often, and at the first sighting once it
// has gone untold for 6 or 24 hours, by its kind (src/policy/alerts.ts). Once
// told, it waits on the Tasks board's "Needs a hand" until it is resolved, by
// the code that sees it put right or by ops there (src/domain/ops/needs-a-hand.ts).
// Resolving it closes it; if it happens after that, it is new.
//
// A message carries IDs, never a name, number or address. The chat post also
// scrubs numbers and e-mail addresses, as a last defence (src/providers/alerts.ts).

import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { OPS_ORIGIN, type EnvironmentName } from "../../config/environments.ts";
import { HOUR_MS } from "../../lib/durations.ts";
import type { Logger } from "../../log.ts";
import { alertKind, retellAfterHours } from "../../policy/alerts.ts";
import type { Alert } from "../../providers/alerts.ts";

export interface RaisedAlert {
  /** What went wrong, and to what: "invoice_draft:<appointmentId>". */
  readonly key: string;
  /** What happened and what to do, with IDs only. */
  readonly message: string;
  /** Where in the ops console to act on it, as a path: "/clients/<personId>". */
  readonly link?: string;
  /** How many times it must happen before anyone is told. Once, unless a single failure is to be expected. */
  readonly after?: number;
}

export type AlertOnce = (raised: RaisedAlert) => Promise<void>;
export type ResolveAlert = (key: string) => Promise<void>;

/** The client's Payments tab, where an alert about their money is acted on. */
export const paymentsTab = (personId: string): string => `/clients/${personId}/payments`;

/** The chat is told again as the count reaches each of these multiples of `after`, whatever the clock says. */
const RETOLD_AT = [10, 100, 1000];

/** An open alert as one more sighting of it left it. */
interface Sighting {
  readonly id: string;
  readonly count: number;
  readonly firstSeenAt: string;
  /** Null until the chat is first told of it. */
  readonly lastToldAt: string | null;
}

export function createAlertOnce(deps: {
  db: D1Database;
  alert: Alert;
  now: () => Date;
  environment: EnvironmentName;
  log: Logger;
}): AlertOnce {
  const { db, alert, now, environment, log } = deps;

  return async ({ key, message, link, after = 1 }) => {
    const text = link === undefined ? message : `${message} ${OPS_ORIGIN[environment]}${link}`;
    const at = now();
    let sighting: Sighting;
    try {
      sighting = await countSighting(db, { key, message, link: link ?? null }, at);
      if (!isTellingDue(sighting, after, retellAfterMs(key), at)) return;
      if (!(await markTold(db, sighting, at))) return;
    } catch (error) {
      // With nothing kept there is no knowing whether ops were told already, so they are told.
      log.error("alert_not_stored", { key, error });
      await alert(text);
      return;
    }

    await alert(sighting.lastToldAt === null ? text : `${stillOpen(sighting)}: ${text}`);
  };
}

export function createResolveAlert(deps: { db: D1Database; now: () => Date }): ResolveAlert {
  return async (key) => {
    await resolveAlertStatement(deps.db, key, deps.now()).run();
  };
}

/** Resolves the key's open alert, in the batch that puts right what it was about. */
export const resolveAlertStatement = (db: D1Database, key: string, now: Date): D1PreparedStatement =>
  db.prepare("UPDATE alerts SET resolved_at = ?2 WHERE key = ?1 AND resolved_at IS NULL").bind(key, now.toISOString());

/** Opens the key's alert, or counts one more sighting of the open one. */
async function countSighting(
  db: D1Database,
  alert: { key: string; message: string; link: string | null },
  now: Date,
): Promise<Sighting> {
  const row = await db
    .prepare(
      `INSERT INTO alerts (id, key, message, link, count, first_seen_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
       ON CONFLICT (key) WHERE resolved_at IS NULL DO UPDATE SET
         count = count + 1, message = excluded.message, link = excluded.link, last_seen_at = excluded.last_seen_at
       RETURNING id, count, first_seen_at, last_told_at`,
    )
    .bind(crypto.randomUUID(), alert.key, alert.message, alert.link, now.toISOString())
    .first<{ id: string; count: number; first_seen_at: string; last_told_at: string | null }>();
  if (row === null) throw new Error("the alert was not kept");
  return { id: row.id, count: row.count, firstSeenAt: row.first_seen_at, lastToldAt: row.last_told_at };
}

const retellAfterMs = (key: string): number => retellAfterHours(alertKind(key)) * HOUR_MS;

/** Its `after`-th sighting tells it first; after that, a count in RETOLD_AT, or the first sighting past the clock. */
function isTellingDue(sighting: Sighting, after: number, retellAfter: number, now: Date): boolean {
  if (sighting.count < after) return false;
  if (sighting.lastToldAt === null) return true;
  if (RETOLD_AT.some((multiple) => sighting.count === after * multiple)) return true;
  return now.getTime() - Date.parse(sighting.lastToldAt) >= retellAfter;
}

/**
 * Marks the alert told now: from its first telling it waits on the Tasks board's "Needs a hand". False where another
 * sighting told it first, so the chat hears of it once.
 */
async function markTold(db: D1Database, sighting: Sighting, now: Date): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE alerts SET told_at = COALESCE(told_at, ?2), last_told_at = ?2 WHERE id = ?1 AND last_told_at IS ?3",
    )
    .bind(sighting.id, now.toISOString(), sighting.lastToldAt)
    .run();
  return result.meta.changes === 1;
}

/** "Still open since Mon 21 Sep, 12 pm, 37 times". */
function stillOpen(sighting: Sighting): string {
  const since = `${shortDate(indiaDate(sighting.firstSeenAt))}, ${indiaClock(sighting.firstSeenAt)}`;
  return `Still open since ${since}, ${String(sighting.count)} times`;
}
