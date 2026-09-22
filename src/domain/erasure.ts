// Erasing a person on request. The photo notice promises "Message us and it is
// deleted the same day"; this is what the operators' endpoint does. See
// docs/decisions/0019-erasure.md.
//
// In order: the photos and results are deleted from R2, then one D1 batch
// blanks the person, ends their sessions, cancels their unsent messages,
// expires their jobs and records the withdrawal. The CRM is updated afterwards
// by the crm-sync queue. R2 goes first so that a failure part-way leaves the
// person findable, and the request can simply be repeated.
//
// A render still running cannot store its result once its job is expired: the
// render consumer deletes what it wrote when it finds the job has moved on. A
// result stored between our read and the batch is deleted after the batch.

import { RUNNING_STATES, type JobState } from "../config/tryon.ts";
import { recordEvent } from "./tryon.ts";

export interface ErasureSummary {
  readonly personId: string;
  readonly erasedAt: string;
  readonly photosDeleted: number;
  readonly resultsDeleted: number;
  readonly messagesCancelled: number;
}

export type ErasureEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS">;

/** The summary, or null when no one (still unerased) has this number. */
export async function erasePerson(env: ErasureEnv, mobileE164: string, now: Date): Promise<ErasureSummary | null> {
  const db = env.DB;
  const person = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(mobileE164)
    .first<{ id: string }>();
  if (person === null) return null;
  const personId = person.id;

  const { results: jobs } = await db
    .prepare("SELECT id, state, upload_key, upload_deleted_at, result_key FROM tryon_jobs WHERE person_id = ?1")
    .bind(personId)
    .all<{
      id: string;
      state: JobState;
      upload_key: string;
      upload_deleted_at: string | null;
      result_key: string | null;
    }>();
  const photos = [...new Set(jobs.filter((job) => job.upload_deleted_at === null).map((job) => job.upload_key))];
  const results = jobs.flatMap((job) => (job.result_key === null ? [] : [job.result_key]));
  if (photos.length > 0) await env.UPLOADS.delete(photos);
  if (results.length > 0) await env.RESULTS.delete(results);

  // One withdrawal row for each purpose the person had agreed to. Consents are append-only.
  const { results: granted } = await db
    .prepare("SELECT DISTINCT purpose FROM consents WHERE person_id = ?1 AND granted = 1")
    .bind(personId)
    .all<{ purpose: string }>();

  const at = now.toISOString();
  const withdrawals = granted.map(({ purpose }) =>
    db
      .prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES (?1, ?2, ?3, 'withdrawal', 0, ?4)`,
      )
      .bind(crypto.randomUUID(), personId, purpose, at),
  );
  const outcome = await db.batch([
    db
      .prepare(
        `UPDATE outbound_messages SET state = 'skipped', last_error = 'person erased'
         WHERE person_id = ?1 AND state IN ('waiting', 'queued') RETURNING id`,
      )
      .bind(personId),
    db
      .prepare(
        `UPDATE tryon_jobs SET state = CASE WHEN state = 'failed' THEN state ELSE 'expired' END, result_key = NULL,
           upload_deleted_at = COALESCE(upload_deleted_at, ?2)
         WHERE person_id = ?1`,
      )
      .bind(personId, at),
    db.prepare("DELETE FROM tryon_sessions WHERE person_id = ?1").bind(personId),
    // The client app: every session ends, and every open login code stops working (docs/decisions/0029, 0030).
    db
      .prepare(
        "UPDATE sessions SET revoked_at = ?2 WHERE subject_kind = 'client' AND subject_id = ?1 AND revoked_at IS NULL",
      )
      .bind(personId, at),
    db
      .prepare("UPDATE otp_challenges SET voided_at = ?2, code_hash = NULL WHERE person_id = ?1 AND voided_at IS NULL")
      .bind(personId, at),
    // The number is replaced, not kept: a later booking from it starts afresh, with a new consent.
    db
      .prepare(
        `UPDATE people SET erased_at = ?2, name = 'Erased', email = NULL, mobile_e164 = 'erased:' || id,
           contactable = 0
         WHERE id = ?1`,
      )
      .bind(personId, at),
    ...withdrawals,
    recordEvent(db, "person_erased", personId, { photos: photos.length, results: results.length }, now),
  ]);

  const late = jobs
    .filter((job) => RUNNING_STATES.includes(job.state))
    .flatMap((job) => [`results/${job.id}.png`, `results/${job.id}.jpg`]);
  if (late.length > 0) await env.RESULTS.delete(late);

  return {
    personId,
    erasedAt: at,
    photosDeleted: photos.length,
    resultsDeleted: results.length,
    messagesCancelled: outcome[0]?.results.length ?? 0,
  };
}
