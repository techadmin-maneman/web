// A client's request to delete their account (src/policy/account-deletion.ts).
// Ops process it, and processing is the erasure Phase 1 already has
// (docs/decisions/0019-erasure.md): photographs, results and details, the same day.

import { erasePerson, type ErasureEnv } from "./erasure.ts";

export type DeletionState = "requested" | "done" | "rejected";

export interface DeletionRequest {
  readonly id: string;
  readonly personId: string;
  readonly state: DeletionState;
  readonly createdAt: string;
}

/** The client's open request, or a new one: asking twice makes no second request. */
export async function requestDeletion(
  db: D1Database,
  personId: string,
  now: Date,
): Promise<{ request: DeletionRequest; created: boolean }> {
  const open = await openDeletion(db, personId);
  if (open !== null) return { request: open, created: false };
  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, ?3, 'requested')")
    .bind(id, personId, now.toISOString())
    .run();
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

/** The requests waiting for ops, oldest first, with the number ops will reach the client on. */
export async function deletionsWaiting(
  db: D1Database,
): Promise<{ id: string; personId: string; name: string; mobileE164: string; createdAt: string }[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.person_id, p.name, p.mobile_e164, d.created_at
       FROM deletion_requests d JOIN people p ON p.id = d.person_id
       WHERE d.state = 'requested' ORDER BY d.created_at`,
    )
    .all<{ id: string; person_id: string; name: string; mobile_e164: string; created_at: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    personId: row.person_id,
    name: row.name,
    mobileE164: row.mobile_e164,
    createdAt: row.created_at,
  }));
}

/** Ops' decision: "delete" erases the person at once; "reject" keeps them, with the reason. */
export async function decideDeletion(
  env: ErasureEnv,
  options: { id: string; decision: "delete" | "reject"; staff: string; reason: string | null; now: Date },
): Promise<"decided" | "not_waiting"> {
  const db = env.DB;
  const request = await db
    .prepare(
      `SELECT d.person_id, p.mobile_e164 FROM deletion_requests d JOIN people p ON p.id = d.person_id
       WHERE d.id = ?1 AND d.state = 'requested'`,
    )
    .bind(options.id)
    .first<{ person_id: string; mobile_e164: string }>();
  if (request === null) return "not_waiting";

  if (options.decision === "delete") await erasePerson(env, request.mobile_e164, options.now);
  await db
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
    )
    .run();
  return "decided";
}

/** Ops are told when a request has waited this long, so it is processed within its 7 days. */
export const DELETION_ALERT_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/** Alerts ops, once per request, about deletion requests nearing the end of their 7 days. */
export async function alertAgedDeletions(
  db: D1Database,
  now: Date,
  alert: (message: string) => Promise<void>,
): Promise<number> {
  const aged = await db
    .prepare(
      `UPDATE deletion_requests SET alerted_at = ?2
       WHERE state = 'requested' AND alerted_at IS NULL AND created_at < ?1 RETURNING id`,
    )
    .bind(new Date(now.getTime() - DELETION_ALERT_AFTER_MS).toISOString(), now.toISOString())
    .all<{ id: string }>();
  const count = aged.results.length;
  if (count > 0) {
    await alert(
      `${String(count)} account deletion request(s) have waited 5 days. Each must be processed within 7 ` +
        "(ops console, deletion requests).",
    );
  }
  return count;
}
