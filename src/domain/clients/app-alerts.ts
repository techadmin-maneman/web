// The client's alerts in their app (docs/decisions/0255-client-alerts-and-push.md): the inbox, newest first, marked read
// once opened; the session that takes the pushes; and the cron's push of each alert new since, which carries nothing,
// so the app reads the inbox itself. Migration 0211's triggers write the alerts, whatever wrote the message.

import type { CallBudget } from "../../lib/call-budget.ts";
import { DAY_MS } from "../../lib/durations.ts";
import { CLIENT_INBOX_DAYS, PUSH_SESSIONS_MAX, type ClientAlertKind } from "../../policy/client-alerts.ts";
import { PUSH_TTL_SECONDS } from "../../policy/tech-alerts.ts";
import type { Push } from "../../providers/web-push.ts";
import { liveUpdateKindOf, type LiveUpdateKind } from "../visits/live-visit.ts";

export interface ClientAlert {
  readonly id: string;
  readonly kind: ClientAlertKind;
  /** The visit it is about, where it is about one. */
  readonly visit_id: string | null;
  /** A technician's word: on the way, running late or at the gate, with the minutes they gave. */
  readonly update: { readonly kind: LiveUpdateKind; readonly minutes: number | null } | null;
  readonly at: string;
  readonly read: boolean;
}

interface AlertRow {
  id: string;
  kind: ClientAlertKind;
  visit_id: string | null;
  preset: Parameters<typeof liveUpdateKindOf>[0] | null;
  minutes: number | null;
  written_at: string;
  read_at: string | null;
}

/** How many of the inbox's alerts the client has not read: the bell's count. */
export async function unreadClientAlerts(db: D1Database, personId: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - CLIENT_INBOX_DAYS * DAY_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS unread FROM client_app_alerts
        WHERE person_id = ?1 AND written_at >= ?2 AND read_at IS NULL`,
    )
    .bind(personId, since)
    .first<{ unread: number }>();
  return row?.unread ?? 0;
}

/** The client's alerts of the inbox's days, newest first. */
export async function clientInboxOf(db: D1Database, personId: string, now: Date): Promise<ClientAlert[]> {
  const since = new Date(now.getTime() - CLIENT_INBOX_DAYS * DAY_MS).toISOString();
  const { results } = await db
    .prepare(
      `SELECT al.id, al.kind, al.written_at, al.read_at, tu.preset, tu.minutes,
              CASE al.subject_kind WHEN 'appointment' THEN al.subject_id
                ELSE COALESCE(tu.appointment_id, mp.appointment_id, pa.appointment_id) END AS visit_id
         FROM client_app_alerts al
         LEFT JOIN technician_updates tu ON al.subject_kind = 'technician_update' AND tu.id = al.subject_id
         LEFT JOIN move_proposals mp ON al.subject_kind = 'move_proposal' AND mp.id = al.subject_id
         LEFT JOIN payments pa ON al.subject_kind = 'payment' AND pa.id = al.subject_id
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
    update: row.preset === null ? null : { kind: liveUpdateKindOf(row.preset), minutes: row.minutes },
    at: row.written_at,
    read: row.read_at !== null,
  }));
}

/**
 * An alert where no message stands beside it: a change the client must hear of, told in their app alone as they agreed
 * to no WhatsApp about visits. Once by its key, in the batch of the change.
 */
export const alertStatement = (
  db: D1Database,
  alert: {
    readonly personId: string;
    readonly kind: ClientAlertKind;
    readonly subject: { readonly kind: string; readonly id: string };
    readonly onceKey: string;
    readonly at: string;
  },
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT OR IGNORE INTO client_app_alerts (id, person_id, kind, subject_kind, subject_id, once_key, written_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(
      crypto.randomUUID(),
      alert.personId,
      alert.kind,
      alert.subject.kind,
      alert.subject.id,
      alert.onceKey,
      alert.at,
    );

/** Every alert the client has, read: they opened the inbox. */
export async function markClientAlertsRead(db: D1Database, personId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE client_app_alerts SET read_at = ?2 WHERE person_id = ?1 AND read_at IS NULL")
    .bind(personId, now.toISOString())
    .run();
}

/**
 * The session's push subscription, one a session. A browser keeps one subscription whoever signs in on it, so the
 * address moves to the session of whoever signed in last. A client's sessions past the newest few still live to
 * subscribe lose theirs, never this one, so no client's alert takes more than a few of a run's calls.
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
    db
      .prepare(
        `DELETE FROM client_push_subscriptions WHERE session_id IN (
           SELECT s.session_id FROM sessions se
             JOIN client_push_subscriptions s ON s.session_id = se.id
            WHERE se.subject_kind = 'client' AND se.subject_id = (SELECT subject_id FROM sessions WHERE id = ?1)
            -- This session first, then those still live, newest to subscribe first.
            ORDER BY se.id = ?1 DESC, (se.revoked_at IS NULL AND se.expires_at > ?3) DESC, s.subscribed_at DESC,
              s.rowid DESC
            LIMIT -1 OFFSET ?2
         )`,
      )
      .bind(sessionId, PUSH_SESSIONS_MAX, now.toISOString()),
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
