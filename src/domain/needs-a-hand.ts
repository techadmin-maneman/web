// The Tasks board's "Needs a hand": the alerts still open that ops have been told of (src/domain/alerts.ts), and
// what ops do with one there. Marking it done closes it, under whoever did. Sending it again puts back the message,
// the lead to the CRM or the erasure there that the alert gave up on, and closes the alert: if it fails again, that
// is a new alert, and ops are told again.

import type { Logger } from "../log.ts";
import { alertKind, alertSubject, type SentAgainKind } from "../policy/alerts.ts";
import type { CrmSyncMessage } from "../queues/crm-sync.ts";
import type { MessagingMessage } from "../queues/messaging.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";

/** The most open alerts one look reads: far more than ever wait at once, so the list is whole below it. */
export const ALERTS_READ = 500;

export interface OpenAlert {
  readonly id: string;
  /** What went wrong, and to what: "crm_lead:<leadId>". */
  readonly key: string;
  /** The key up to its first colon: "crm_lead". */
  readonly kind: string;
  readonly message: string;
  /** Where in the console to act on it: "/clients/<personId>". */
  readonly link: string | null;
  /** How many times it has happened. */
  readonly count: number;
  readonly toldAt: string;
  readonly lastSeenAt: string;
}

interface AlertRow {
  id: string;
  key: string;
  message: string;
  link: string | null;
  count: number;
  told_at: string;
  last_seen_at: string;
}

const COLUMNS = "id, key, message, link, count, told_at, last_seen_at";

const openAlertOf = (row: AlertRow): OpenAlert => ({
  id: row.id,
  key: row.key,
  kind: alertKind(row.key),
  message: row.message,
  link: row.link,
  count: row.count,
  toldAt: row.told_at,
  lastSeenAt: row.last_seen_at,
});

/** The open alerts ops have been told of, the longest open first. */
export async function openAlerts(db: D1Database): Promise<OpenAlert[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM alerts WHERE resolved_at IS NULL AND told_at IS NOT NULL ORDER BY told_at LIMIT ?1`,
    )
    .bind(ALERTS_READ)
    .all<AlertRow>();
  return results.map(openAlertOf);
}

/** One open alert ops have been told of; null once it is resolved, or if there never was one. */
export async function openAlert(db: D1Database, id: string): Promise<OpenAlert | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM alerts WHERE id = ?1 AND resolved_at IS NULL AND told_at IS NOT NULL`)
    .bind(id)
    .first<AlertRow>();
  return row === null ? null : openAlertOf(row);
}

interface Acting {
  readonly now: Date;
  readonly audit: AuditEntry;
}

const closeStatement = (db: D1Database, alert: OpenAlert, now: Date): D1PreparedStatement =>
  db
    .prepare("UPDATE alerts SET resolved_at = ?2 WHERE id = ?1 AND resolved_at IS NULL")
    .bind(alert.id, now.toISOString());

/**
 * Ops mark it done, with its audit entry. For an erasure the CRM gave up on, done means ops blanked the record by
 * hand, so the person is recorded as erased there.
 */
export async function markDone(db: D1Database, alert: OpenAlert, { now, audit }: Acting): Promise<void> {
  const statements = [closeStatement(db, alert, now), auditStatement(db, audit, now)];
  if (alert.kind === "crm_erasure") {
    statements.push(
      db
        .prepare(
          "UPDATE people SET crm_erased_at = ?2 WHERE id = ?1 AND erased_at IS NOT NULL AND crm_erased_at IS NULL",
        )
        .bind(alertSubject(alert.key), now.toISOString()),
    );
  }
  await db.batch(statements);
}

export type SendAgainEnv = Pick<Env, "DB" | "CRM_QUEUE" | "MESSAGE_QUEUE">;

/**
 * Puts what the alert gave up on back where the sweeper finds it, closes the alert with its audit entry, and puts it
 * on its queue so it goes at once. A queue that refuses it costs nothing but time: the sweeper sends it on its next
 * pass.
 */
export async function sendAgain(
  env: SendAgainEnv,
  alert: OpenAlert,
  kind: SentAgainKind,
  options: Acting & { readonly requestId: string; readonly log: Logger },
): Promise<void> {
  const db = env.DB;
  const subject = alertSubject(alert.key);
  const { now, audit } = options;
  await db.batch([putBack(db, kind, subject, now), closeStatement(db, alert, now), auditStatement(db, audit, now)]);
  try {
    await queueAgain(env, kind, subject, options.requestId);
  } catch (error) {
    options.log.warn("send_again_not_queued", { kind, error });
  }
}

/** The message waits to be sent, the lead to be synced, or the erasure to be made, with its tries counted afresh. */
function putBack(db: D1Database, kind: SentAgainKind, subject: string, now: Date): D1PreparedStatement {
  if (kind === "message_failed") {
    return db
      .prepare(
        `UPDATE outbound_messages SET state = 'queued', attempts = 0, sending_at = NULL, queued_at = ?2
         WHERE id = ?1 AND state = 'failed'`,
      )
      .bind(subject, now.toISOString());
  }
  if (kind === "crm_lead") {
    return db.prepare("UPDATE leads SET sync_attempts = 0 WHERE id = ?1 AND sync_state = 'failed'").bind(subject);
  }
  return db
    .prepare(
      "UPDATE people SET crm_erasure_attempts = 0 WHERE id = ?1 AND erased_at IS NOT NULL AND crm_erased_at IS NULL",
    )
    .bind(subject);
}

async function queueAgain(env: SendAgainEnv, kind: SentAgainKind, subject: string, requestId: string): Promise<void> {
  if (kind === "message_failed") {
    await env.MESSAGE_QUEUE.send({ message_id: subject, request_id: requestId } satisfies MessagingMessage);
    return;
  }
  if (kind === "crm_lead") {
    await env.CRM_QUEUE.send({ lead_id: subject, request_id: requestId } satisfies CrmSyncMessage);
    return;
  }
  await env.CRM_QUEUE.send({ erase_person_id: subject, request_id: requestId } satisfies CrmSyncMessage);
}
