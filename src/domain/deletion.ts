// A client's request to delete their account (src/policy/account-deletion.ts).
// Ops process it, and processing is the erasure Phase 1 already has
// (docs/decisions/0019-erasure.md): photographs, results and details, the same day.
// Either way the client is told on WhatsApp, as their app promises.

import type { Logger } from "../log.ts";
import type { PlacesReached } from "../policy/access.ts";
import { DELETION_DECIDED_WITHIN_DAYS, erasureRefusal, type ErasureRefusal } from "../policy/account-deletion.ts";
import { DECISION_SHOWN_DAYS } from "../policy/decision-reasons.ts";
import type { OutboundMessage } from "../providers/messaging.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { eraseAndQueue, erasureBlockers, type ErasureBlockers, type ErasureQueueEnv } from "./erasure.ts";
import { reachBinding, withinReach } from "./places.ts";
import { liveContact } from "./profile.ts";
import type { Composed } from "./visit-messages.ts";
import { DAY_MS } from "../lib/durations.ts";
import { firstNameOf } from "../lib/names.ts";

export type DeletionState = "requested" | "done" | "rejected";

export interface DeletionRequest {
  readonly id: string;
  readonly personId: string;
  readonly state: DeletionState;
  readonly createdAt: string;
}

/**
 * The client's open request, or a new one, recorded with its audit entry: asking
 * twice makes no second request.
 */
export async function requestDeletion(
  db: D1Database,
  personId: string,
  now: Date,
  audit: AuditEntry,
): Promise<{ request: DeletionRequest; created: boolean }> {
  const open = await openDeletion(db, personId);
  if (open !== null) return { request: open, created: false };
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare("INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')")
      .bind(id, personId, now.toISOString()),
    auditStatement(db, { ...audit, subject: { kind: "deletion", id } }, now),
  ]);
  return { request: { id, personId, state: "requested", createdAt: now.toISOString() }, created: true };
}

export async function openDeletion(db: D1Database, personId: string): Promise<DeletionRequest | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, state, created_at FROM deletion_requests
       WHERE person_id = ?1 AND state = 'requested' ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(personId)
    .first<{ id: string; person_id: string; state: DeletionState; created_at: string }>();
  return row === null ? null : { id: row.id, personId: row.person_id, state: row.state, createdAt: row.created_at };
}

/**
 * The requests waiting for ops in the places reached, oldest first, with the number ops will reach the client on. A
 * client erased with a request still open, before an erasure closed it, waits for nothing.
 */
export async function deletionsWaiting(
  db: D1Database,
  reached: PlacesReached,
): Promise<{ id: string; personId: string; name: string; mobileE164: string; createdAt: string }[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.person_id, p.name, p.mobile_e164, d.created_at
       FROM deletion_requests d JOIN people p ON p.id = d.person_id
       WHERE d.state = 'requested' AND p.erased_at IS NULL AND ${withinReach("deletion_request", "d", "?1")}
       ORDER BY d.created_at`,
    )
    .bind(reachBinding(reached))
    .all<{ id: string; person_id: string; name: string; mobile_e164: string; created_at: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    personId: row.person_id,
    name: row.name,
    mobileE164: row.mobile_e164,
    createdAt: row.created_at,
  }));
}

/** The name and number of a client being erased, read before the erasure blanks them. */
export interface ErasedContact {
  readonly name: string;
  readonly mobileE164: string;
}

export type DeletionOutcome =
  | { readonly kind: "rejected"; readonly personId: string; readonly messageId: string }
  /** `told` is who to tell, or null when someone erased them first and their number is gone. */
  | { readonly kind: "deleted"; readonly personId: string; readonly told: ErasedContact | null }
  | { readonly kind: "not_waiting" }
  | { readonly kind: "refused"; readonly refusal: ErasureRefusal; readonly blockers: ErasureBlockers };

/**
 * Ops' decision: "delete" erases the person at once; "reject" keeps them, with
 * the reason, and queues the message that tells them why. The decision's audit
 * entry and the request's new state go in the erasure's own batch, so a
 * decision is recorded only if it happened. Deleting is refused while the
 * person has a visit booked or a payment held (src/policy/account-deletion.ts),
 * and the request waits.
 */
export async function decideDeletion(
  env: ErasureQueueEnv,
  options: {
    id: string;
    decision: "delete" | "reject";
    staff: string;
    reason: string | null;
    audit: AuditEntry;
    fsmConnected: boolean;
    requestId: string;
    now: Date;
    log: Logger;
  },
): Promise<DeletionOutcome> {
  const db = env.DB;
  const audit = auditStatement(db, options.audit, options.now);
  const request = await db
    .prepare("SELECT person_id FROM deletion_requests WHERE id = ?1 AND state = 'requested'")
    .bind(options.id)
    .first<{ person_id: string }>();
  if (request === null) return { kind: "not_waiting" };
  const personId = request.person_id;

  const decided = db
    .prepare(
      `UPDATE deletion_requests SET state = ?2, decided_at = ?3, decided_by = ?4, reason = ?5
       WHERE id = ?1 AND state = 'requested'`,
    )
    .bind(
      options.id,
      options.decision === "delete" ? "done" : "rejected",
      options.now.toISOString(),
      options.staff,
      options.reason,
    );
  if (options.decision === "reject") {
    const message = rejectionMessage(db, { personId, requestId: options.id, now: options.now });
    await db.batch([audit, decided, message.statement]);
    return { kind: "rejected", personId, messageId: message.id };
  }

  const blockers = await erasureBlockers(db, personId);
  const refusal = erasureRefusal(blockers);
  if (refusal !== null) return { kind: "refused", refusal, blockers };
  const told = await liveContact(db, personId);
  const erased = await eraseAndQueue(env, personId, {
    audit: options.audit,
    alongside: [decided],
    fsmConnected: options.fsmConnected,
    requestId: options.requestId,
    now: options.now,
    log: options.log,
  });
  if (erased !== null) return { kind: "deleted", personId, told };
  // Erased already, before an erasure closed the requests it found open: this one is done all the same.
  await db.batch([audit, decided]);
  return { kind: "deleted", personId, told: null };
}

/** The message that tells the client ops kept their account, and why; for the batch that rejects the request. */
function rejectionMessage(
  db: D1Database,
  input: { personId: string; requestId: string; now: Date },
): { id: string; statement: D1PreparedStatement } {
  const id = crypto.randomUUID();
  const statement = db
    .prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state, queued_at)
       VALUES (?1, ?2, ?3, 'deletion_rejected', 'deletion', ?4, 'queued', ?2)`,
    )
    .bind(id, input.now.toISOString(), input.personId, input.requestId);
  return { id, statement };
}

/** Ops' reason as the message quotes it: a sentence, ending in a full stop. */
function asSentence(reason: string): string {
  const trimmed = reason.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * What a queued rejection says: the client's first name and ops' reason. It answers the client's own request about
 * their data, so it goes whatever they chose about visit messages.
 */
export async function composeDeletionRejected(db: D1Database, requestId: string, personId: string): Promise<Composed> {
  const row = await db
    .prepare(
      `SELECT p.name, d.reason FROM deletion_requests d JOIN people p ON p.id = d.person_id
       WHERE d.id = ?1 AND d.person_id = ?2 AND d.state = 'rejected'`,
    )
    .bind(requestId, personId)
    .first<{ name: string; reason: string | null }>();
  if (row === null) return { skip: "the request was not rejected" };
  if (row.reason === null) return { skip: "no reason was recorded" };
  return { template: "deletion_rejected_v1", params: [firstNameOf(row.name), asSentence(row.reason)] };
}

/** The last message to an erased client, sent to the number read before the erasure blanked it. */
export function deletionDoneMessage(contact: ErasedContact): OutboundMessage {
  return { to: contact.mobileE164, template: "deletion_done_v1", params: [firstNameOf(contact.name)] };
}

export interface RejectedDeletion {
  readonly decidedAt: string;
  /** Ops' reason, which the client is shown. */
  readonly reason: string | null;
}

/**
 * The client's latest request ops rejected, within DECISION_SHOWN_DAYS, so the profile can say what became of it
 * rather than let it vanish. A request ops granted leaves nobody signed in to read it.
 */
export async function lastRejectedDeletion(
  db: D1Database,
  personId: string,
  now: Date,
): Promise<RejectedDeletion | null> {
  const since = new Date(now.getTime() - DECISION_SHOWN_DAYS * DAY_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT decided_at, reason FROM deletion_requests
       WHERE person_id = ?1 AND state = 'rejected' AND decided_at >= ?2
       ORDER BY decided_at DESC LIMIT 1`,
    )
    .bind(personId, since)
    .first<{ decided_at: string; reason: string | null }>();
  return row === null ? null : { decidedAt: row.decided_at, reason: row.reason };
}

/** Ops are told when a request has waited this long, so it is decided within DELETION_DECIDED_WITHIN_DAYS. */
const ALERT_AFTER_DAYS = 5;
export const DELETION_ALERT_AFTER_MS = ALERT_AFTER_DAYS * DAY_MS;

/** Alerts ops, once per request, about deletion requests nearing the end of their days, but not an erased client's. */
export async function alertAgedDeletions(
  db: D1Database,
  now: Date,
  alert: (message: string) => Promise<void>,
): Promise<number> {
  const aged = await db
    .prepare(
      `UPDATE deletion_requests SET alerted_at = ?2
       WHERE state = 'requested' AND alerted_at IS NULL AND created_at < ?1
         AND NOT EXISTS (SELECT 1 FROM people p WHERE p.id = deletion_requests.person_id AND p.erased_at IS NOT NULL)
       RETURNING id`,
    )
    .bind(new Date(now.getTime() - DELETION_ALERT_AFTER_MS).toISOString(), now.toISOString())
    .all<{ id: string }>();
  const count = aged.results.length;
  if (count > 0) {
    await alert(
      `${String(count)} account deletion request(s) have waited ${String(ALERT_AFTER_DAYS)} days. Each must be ` +
        `processed within ${String(DELETION_DECIDED_WITHIN_DAYS)} (ops console, deletion requests).`,
    );
  }
  return count;
}
