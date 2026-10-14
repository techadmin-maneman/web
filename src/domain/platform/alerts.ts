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
// A telling counts only once the chat takes it. One the chat missed is told again at the next sighting, and a first
// telling it missed is tried again every five minutes (retellUndelivered), so an alert raised once still reaches the
// chat. With D1 down nothing can be kept, so each key is told at most once in ten minutes from an isolate.
//
// A message carries IDs, never a name, number or address. The chat post also
// scrubs numbers and e-mail addresses, as a last defence (src/providers/alerts.ts).

import { indiaClock, indiaDate, shortDate } from "@maneman/web-kit/dates";
import { OPS_ORIGIN, type EnvironmentName } from "../../config/environments.ts";
import { HOUR_MS, MINUTE_MS } from "../../lib/durations.ts";
import type { Logger } from "../../log.ts";
import { alertKind, isUrgent, retellAfterHours } from "../../policy/alerts.ts";
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

/** How often a key is told from an isolate while nothing can be kept, so D1 down cannot flood the chat. */
const UNSTORED_RETELL_MS = 10 * MINUTE_MS;

/** The keys this isolate told while nothing could be kept, and when; cleared past a few hundred. */
const toldUnstored = new Map<string, number>();

function toldUnstoredLately(key: string, now: Date): boolean {
  const last = toldUnstored.get(key);
  if (last !== undefined && now.getTime() - last < UNSTORED_RETELL_MS) return true;
  if (toldUnstored.size > 500) toldUnstored.clear();
  toldUnstored.set(key, now.getTime());
  return false;
}

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
  /** The urgent space, told of an urgent alert as well (isUrgent); null where there is none. */
  urgent?: Alert | null;
  now: () => Date;
  environment: EnvironmentName;
  log: Logger;
}): AlertOnce {
  const { db, now, environment, log, urgent = null } = deps;
  /** Tells the alert space, and the urgent space too for an urgent alert; whether the alert space took it. */
  const tell = (key: string) => async (text: string) => {
    const told = (await deps.alert(text)) !== false;
    if (urgent !== null && isUrgent(key)) await urgent(text);
    return told;
  };

  return async ({ key, message, link, after = 1 }) => {
    const alert = tell(key);
    const text = link === undefined ? message : `${message} ${OPS_ORIGIN[environment]}${link}`;
    const at = now();
    let sighting: Sighting;
    try {
      sighting = await countSighting(db, { key, message, link: link ?? null }, at);
      if (!isTellingDue(sighting, after, retellAfterMs(key), at)) return;
      if (!(await markTold(db, sighting, at))) return;
    } catch (error) {
      // With nothing kept there is no knowing whether ops were told already, so they are told, once in a while.
      log.error("alert_not_stored", { key, error });
      if (!toldUnstoredLately(key, at)) await alert(text);
      return;
    }

    if (!(await alert(sighting.lastToldAt === null ? text : `${stillOpen(sighting)}: ${text}`))) {
      await unmarkTold(db, sighting, at, log);
    }
  };
}

/** How many first tellings the chat missed one pass tells again. */
const RETOLD_PER_PASS = 10;

/**
 * Tells the chat of each open alert whose first telling it did not take, oldest first; a pass stops at the first the
 * chat misses again. Run every five minutes by the cron. Answers how many it told.
 */
export async function retellUndelivered(deps: {
  db: D1Database;
  alert: Alert;
  now: () => Date;
  environment: EnvironmentName;
  log: Logger;
}): Promise<number> {
  const { db, now, environment, log } = deps;
  const { results } = await db
    .prepare(
      `SELECT id, message, link, count, first_seen_at FROM alerts
       WHERE resolved_at IS NULL AND told_at IS NOT NULL AND last_told_at IS NULL
       ORDER BY told_at LIMIT ?1`,
    )
    .bind(RETOLD_PER_PASS)
    .all<{ id: string; message: string; link: string | null; count: number; first_seen_at: string }>();
  let told = 0;
  for (const row of results) {
    const at = now();
    const sighting: Sighting = { id: row.id, count: row.count, firstSeenAt: row.first_seen_at, lastToldAt: null };
    if (!(await markTold(db, sighting, at))) continue;
    const text = row.link === null ? row.message : `${row.message} ${OPS_ORIGIN[environment]}${row.link}`;
    if ((await deps.alert(text)) === false) {
      await unmarkTold(db, sighting, at, log);
      break;
    }
    told += 1;
  }
  return told;
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
/**
 * Takes back a telling the chat did not take, so the next sighting, or for a first telling the next retell pass, tells
 * it again. The alert stays on the Tasks board's "Needs a hand" meanwhile. Only the telling this one marked is taken.
 */
async function unmarkTold(db: D1Database, sighting: Sighting, toldAt: Date, log: Logger): Promise<void> {
  try {
    await db
      .prepare("UPDATE alerts SET last_told_at = ?3 WHERE id = ?1 AND last_told_at = ?2")
      .bind(sighting.id, toldAt.toISOString(), sighting.lastToldAt)
      .run();
  } catch (error) {
    log.error("alert_not_unmarked", { id: sighting.id, error });
  }
}

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
