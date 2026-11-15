// The client's alerts in their app (docs/decisions/0255-client-alerts-and-push.md): the inbox, newest first, marked read
// once opened; the session that takes the pushes; and the cron's push of each alert new since, which carries nothing,
// so the app reads the inbox itself. Migration 0211's triggers write the alerts, whatever wrote the message.

import type { CallBudget } from "../../lib/call-budget.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { CLIENT_INBOX_DAYS, type ClientAlertKind } from "../../policy/client-alerts.ts";
import { PUSH_TTL_SECONDS } from "../../policy/tech-alerts.ts";
import type { Push } from "../../providers/web-push.ts";

export interface ClientAlert {
  readonly id: string;
  readonly kind: ClientAlertKind;
  /** The visit it is about, where it is about one. */
  readonly visit_id: string | null;
  /** A technician's word: on the way, running late or at the gate, with the minutes they gave. */
  readonly update: { readonly kind: string; readonly minutes: number | null } | null;
  readonly at: string;
  readonly read: boolean;
}

interface AlertRow {
  id: string;
  kind: ClientAlertKind;
  visit_id: string | null;
  preset: string | null;
  minutes: number | null;
  written_at: string;
  read_at: string | null;
}

/** The client's alerts of the inbox's days, newest first. */
export async function clientInboxOf(db: D1Database, personId: string, now: Date): Promise<ClientAlert[]> {
  const since = new Date(now.getTime() - CLIENT_INBOX_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT al.id, al.kind, al.written_at, al.read_at, tu.preset, tu.minutes,
              CASE al.subject_kind WHEN 'appointment' THEN al.subject_id ELSE tu.appointment_id END AS visit_id
         FROM client_app_alerts al
         LEFT JOIN technician_updates tu ON al.subject_kind = 'technician_update' AND tu.id = al.subject_id
        WHERE al.person_id = ?1 AND al.written_at >= ?2
        ORDER BY al.written_at DESC, al.rowid DESC
        LIMIT 100`,
    )
    .bind(personId, since)
    .all<AlertRow>();
  return results.map((row) => ({
    id: row.id,
    kind: row.kind,
    visit_id: row.visit_id,
    update: row.preset === null ? null : { kind: row.preset, minutes: row.minutes },
    at: row.written_at,
    read: row.read_at !== null,
  }));
}

/** Every alert the client has, read: they opened the inbox. */
export async function markClientAlertsRead(db: D1Database, personId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE client_app_alerts SET read_at = ?2 WHERE person_id = ?1 AND read_at IS NULL")
    .bind(personId, now.toISOString())
    .run();
}

/**
 * The session's push subscription, one a session. A browser keeps one subscription whoever signs in on it, so the
 * address moves to the session of whoever signed in last.
 */
export async function subscribeClientPushes(
  db: D1Database,
  { sessionId, endpoint, now }: { readonly sessionId: string; readonly endpoint: string; readonly now: Date },
): Promise<void> {
  await db.batch([
    db
      .prepare("DELETE FROM client_push_subscriptions WHERE endpoint = ?2 AND session_id <> ?1")
      .bind(sessionId, endpoint),
    db
      .prepare(
        `INSERT INTO client_push_subscriptions (session_id, endpoint, subscribed_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (session_id) DO UPDATE SET endpoint = excluded.endpoint, subscribed_at = excluded.subscribed_at`,
      )
      .bind(sessionId, endpoint, now.toISOString()),
  ]);
}

interface ToPush {
  alert_id: string;
  session_id: string;
  endpoint: string;
}

/**
 * A push for each alert not yet pushed or read, to each session the client is signed in on that takes them, as the
 * run's calls allow; one a push service would no longer keep waits in the inbox. A subscription the push service has
 * forgotten is deleted.
 */
export async function pushNewClientAlerts(
  db: D1Database,
  { push, budget, now }: { readonly push: Push; readonly budget: CallBudget; readonly now: Date },
): Promise<number> {
  const at = now.toISOString();
  const fresh = new Date(now.getTime() - PUSH_TTL_SECONDS * 1000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT al.id AS alert_id, s.session_id, s.endpoint
         FROM client_app_alerts al
        CROSS JOIN sessions se ON se.subject_kind = 'client' AND se.subject_id = al.person_id
          AND se.revoked_at IS NULL AND se.expires_at > ?1
        CROSS JOIN client_push_subscriptions s ON s.session_id = se.id
        WHERE al.written_at >= ?2 AND al.pushed_at IS NULL AND al.read_at IS NULL
        ORDER BY al.written_at`,
    )
    .bind(at, fresh)
    .all<ToPush>();
  const done = new Set<string>();
  const left = new Set<string>();
  const gone: string[] = [];
  for (const each of results) {
    if (left.has(each.alert_id) || !budget.spend(1)) {
      left.add(each.alert_id);
      continue;
    }
    if ((await push(each.endpoint, PUSH_TTL_SECONDS)) === "gone") gone.push(each.session_id);
    done.add(each.alert_id);
  }
  const pushed = [...done].filter((id) => !left.has(id));
  if (pushed.length === 0 && gone.length === 0) return 0;
  await db.batch([
    ...gone.map((session) => db.prepare("DELETE FROM client_push_subscriptions WHERE session_id = ?1").bind(session)),
    db
      .prepare("UPDATE client_app_alerts SET pushed_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
      .bind(at, JSON.stringify(pushed)),
  ]);
  return pushed.length;
}

/** Alerts older than the inbox shows. */
export async function dropOldClientAlerts(db: D1Database, now: Date): Promise<void> {
  const before = new Date(now.getTime() - (CLIENT_INBOX_DAYS + 1) * DAY_MS).toISOString();
  await db.prepare("DELETE FROM client_app_alerts WHERE written_at < ?1").bind(before).run();
}
