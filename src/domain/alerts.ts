// Alerts kept in D1 (migration 0038), so that a failure which needs a person
// reaches one once, with the IDs to act on and a link into the ops console
// (docs/decisions/0067-alerts-and-silent-failures.md).
//
// An alert is raised under a key naming what went wrong and to what:
// "books_refund_refused:<refundId>". Raising it again only counts it. The chat
// hears of it the first time, and again when it has happened 10, 100 and 1,000
// times as often, so a failure that keeps happening does not read as one that
// happened once. Once told, it waits on the Tasks board's "Needs a hand" until
// it is resolved, by the code that sees it put right or by ops there
// (src/domain/needs-a-hand.ts). Resolving it closes it; if it happens after
// that, it is new.
//
// A message carries IDs, never a name, number or address. The chat post also
// scrubs numbers and e-mail addresses, as a last defence (src/providers/alerts.ts).

import { OPS_ORIGIN, type EnvironmentName } from "../config/environments.ts";
import type { Logger } from "../log.ts";
import type { Alert } from "../providers/alerts.ts";

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

/** The chat is told as the count reaches each of these multiples of `after`. */
const TOLD_AT = [1, 10, 100, 1000];

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
    let count: number;
    try {
      count = await countSighting(db, { key, message, link: link ?? null, after }, now());
    } catch (error) {
      // With nothing kept there is no knowing whether ops were told already, so they are told.
      log.error("alert_not_stored", { key, error });
      await alert(text);
      return;
    }

    const multiple = TOLD_AT.find((each) => count === after * each);
    if (multiple === undefined) return;
    await alert(multiple === 1 ? text : `Still happening, ${String(count)} times: ${text}`);
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

/** Whether an alert is open under this key: raised, and not yet resolved. */
export async function isAlertOpen(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM alerts WHERE key = ?1 AND resolved_at IS NULL").bind(key).first();
  return row !== null;
}

/**
 * Opens the key's alert, or counts one more sighting of the open one; how many there have been. Its `after`-th
 * sighting is when it is told, and from then on it waits on the Tasks board's "Needs a hand".
 */
async function countSighting(
  db: D1Database,
  alert: { key: string; message: string; link: string | null; after: number },
  now: Date,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO alerts (id, key, message, link, count, first_seen_at, last_seen_at, told_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, iif(?6 <= 1, ?5, NULL))
       ON CONFLICT (key) WHERE resolved_at IS NULL DO UPDATE SET
         count = count + 1, message = excluded.message, link = excluded.link, last_seen_at = excluded.last_seen_at,
         told_at = COALESCE(told_at, iif(count + 1 >= ?6, excluded.last_seen_at, NULL))
       RETURNING count`,
    )
    .bind(crypto.randomUUID(), alert.key, alert.message, alert.link, now.toISOString(), alert.after)
    .first<{ count: number }>();
  return row?.count ?? 1;
}
