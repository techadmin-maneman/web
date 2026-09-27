// Erasing a person on request. The photo notice promises "Message us and it is
// deleted the same day"; this is what the operators' endpoint and ops' deletion
// decision do. See docs/decisions/0019-erasure.md and
// 0066-erasure-all-or-nothing.md.
//
// In order: one D1 batch blanks the person and what they left, ends their
// sessions, cancels their unsent messages and expires their jobs, with the
// caller's own statements (the audit entry, the request's state) in the same
// batch, so all of it happens or none of it does. Then their files are deleted
// from R2, each before the row that names it. If that fails part-way, the
// person is erased all the same and the cron's erased_files job deletes what
// is left. The CRM and FSM are updated afterwards, by their queues.
//
// Nothing is erased while the person has a visit still to happen or a payment
// held with no visit behind it (src/policy/account-deletion.ts): the caller
// asks erasureBlockers first.
//
// A render still running cannot store its result once its job is expired: the
// render consumer deletes what it wrote when it finds the job has moved on.

import type { VisitType } from "../config/visit-types.ts";
import type { Logger } from "../log.ts";
import { LIVE_VISIT_STATUSES } from "../policy/account-deletion.ts";
import { recordEvent } from "./tryon.ts";

/** R2 deletes at most 1,000 keys a call. */
const R2_DELETE_BATCH = 1000;
/** Most erased people whose files one cron run finishes. */
const LEFT_FILES_PER_RUN = 20;

export interface ErasureSummary {
  readonly personId: string;
  readonly erasedAt: string;
  readonly photosDeleted: number;
  readonly resultsDeleted: number;
  readonly messagesCancelled: number;
  readonly visitPhotosDeleted: number;
}

export interface ErasureBlockers {
  readonly visits: readonly {
    readonly id: string;
    readonly type: VisitType | null;
    readonly status: (typeof LIVE_VISIT_STATUSES)[number];
    readonly window_start: string | null;
  }[];
  readonly payments: readonly { readonly id: string; readonly reference: string | null; readonly amount: number }[];
}

export type ErasureEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS" | "REFERRAL_CARDS">;

/** The person, not yet erased, who has this number. */
export async function personWithMobile(db: D1Database, mobileE164: string): Promise<string | null> {
  const person = await db
    .prepare("SELECT id FROM people WHERE mobile_e164 = ?1 AND erased_at IS NULL")
    .bind(mobileE164)
    .first<{ id: string }>();
  return person?.id ?? null;
}

/** The visits still to happen, and the payments held with no visit behind them, that ops settle before erasing. */
export async function erasureBlockers(db: D1Database, personId: string): Promise<ErasureBlockers> {
  const { results: visits } = await db
    .prepare(
      `SELECT id, type, status, window_start FROM appointments
       WHERE person_id = ?1 AND deleted_at IS NULL AND status IN (SELECT value FROM json_each(?2))
       ORDER BY window_start`,
    )
    .bind(personId, JSON.stringify(LIVE_VISIT_STATUSES))
    .all<ErasureBlockers["visits"][number]>();
  const { results: payments } = await db
    .prepare(
      `SELECT id, reference, amount FROM payments
       WHERE person_id = ?1 AND appointment_id IS NULL AND status = 'captured'
       ORDER BY captured_at`,
    )
    .bind(personId)
    .all<ErasureBlockers["payments"][number]>();
  return { visits, payments };
}

/**
 * Erases the person, with `alongside` in the same D1 batch, then deletes their
 * files. Null when they are already erased.
 */
export async function erasePerson(
  env: ErasureEnv,
  personId: string,
  now: Date,
  log: Logger,
  alongside: readonly D1PreparedStatement[] = [],
): Promise<ErasureSummary | null> {
  const db = env.DB;
  const counts = await db
    .prepare(
      `SELECT
         (SELECT COUNT(DISTINCT upload_key) FROM tryon_jobs WHERE person_id = ?1 AND upload_deleted_at IS NULL) AS photos,
         (SELECT COUNT(*) FROM tryon_jobs WHERE person_id = ?1 AND result_key IS NOT NULL) AS results,
         (SELECT COUNT(*) FROM photos ph JOIN photo_sets s ON s.id = ph.photo_set_id
            JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1) AS visit_photos
       FROM people WHERE id = ?1 AND erased_at IS NULL`,
    )
    .bind(personId)
    .first<{ photos: number; results: number; visit_photos: number }>();
  if (counts === null) return null;

  const at = now.toISOString();
  const outcome = await db.batch([
    db
      .prepare(
        `UPDATE outbound_messages SET state = 'skipped', last_error = 'person erased'
         WHERE person_id = ?1 AND state IN ('waiting', 'queued') RETURNING id`,
      )
      .bind(personId),
    ...alongside,
    ...(await personalDataStatements(db, personId, at)),
    recordEvent(db, "person_erased", personId, { photos: counts.photos, results: counts.results }, now),
  ]);

  try {
    await deleteErasedFiles(env, personId, now);
  } catch (error) {
    log.warn("erasure_files_left", { person_id: personId, error }); // the cron's erased_files job finishes them
  }

  return {
    personId,
    erasedAt: at,
    photosDeleted: counts.photos,
    resultsDeleted: counts.results,
    messagesCancelled: outcome[0]?.results.length ?? 0,
    visitPhotosDeleted: counts.visit_photos,
  };
}

/** Of the person's addresses, one a technician's check-in was measured against. */
const MEASURED_AGAINST = "EXISTS (SELECT 1 FROM checkins c WHERE c.address_id = addresses.id)";

/**
 * Everything else the batch changes, in an order the foreign keys allow: what
 * points at a row is dealt with before the row is deleted.
 */
async function personalDataStatements(db: D1Database, personId: string, at: string): Promise<D1PreparedStatement[]> {
  // One withdrawal row for each purpose the person had agreed to. Consents are append-only.
  const { results: granted } = await db
    .prepare("SELECT DISTINCT purpose FROM consents WHERE person_id = ?1 AND granted = 1")
    .bind(personId)
    .all<{ purpose: string }>();
  const withdrawals = granted.map(({ purpose }) =>
    db
      .prepare(
        `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
         VALUES (?1, ?2, ?3, 'withdrawal', 0, ?4)`,
      )
      .bind(crypto.randomUUID(), personId, purpose, at),
  );

  return [
    // Expired jobs stop any render storing its result; the files go after the batch.
    db
      .prepare(
        "UPDATE tryon_jobs SET state = CASE WHEN state = 'failed' THEN state ELSE 'expired' END WHERE person_id = ?1",
      )
      .bind(personId),
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
    // Waiting for a pincode needs the person's number; an invite they sent stays, with the house card
    // (docs/decisions/0048-referrals.md). The card's file is deleted after the batch.
    db.prepare("DELETE FROM waitlist_entries WHERE person_id = ?1").bind(personId),
    db
      .prepare(
        `UPDATE referral_codes SET card_state = 'house', card_version = card_version + 1, updated_at = ?2
         WHERE person_id = ?1 AND card_state = 'personal'`,
      )
      .bind(personId, at),
    // Phase 2's own personal data (docs/decisions/0049-dpdp.md): where they live, the numbers they changed
    // between, and the words of any grievance. Visits, payments and credits stay, as records. An address a
    // technician's check-in was measured against is blanked to its city and pincode rather than deleted: the
    // check-in points at it, and stays whole as the evidence ops rule a no-show on.
    db
      .prepare(
        `UPDATE addresses SET line1 = 'Erased', line2 = NULL, locality = 'Erased', access_notes = NULL, lat = NULL,
           lng = NULL, geocoded_at = NULL, building = NULL, flat = NULL, floor = NULL, tower = NULL, landmark = NULL,
           place_id = NULL, geocode_source = NULL
         WHERE person_id = ?1 AND ${MEASURED_AGAINST}`,
      )
      .bind(personId),
    db.prepare(`DELETE FROM addresses WHERE person_id = ?1 AND NOT ${MEASURED_AGAINST}`).bind(personId),
    db
      .prepare(
        "DELETE FROM otp_challenges WHERE number_change_id IN (SELECT id FROM number_change_requests WHERE person_id = ?1)",
      )
      .bind(personId),
    db.prepare("DELETE FROM number_change_requests WHERE person_id = ?1").bind(personId),
    db.prepare("UPDATE grievances SET text = 'Erased', response = NULL WHERE person_id = ?1").bind(personId),
    // Ops' own words about them, kept with a decision (docs/decisions/0072-ops-clients-and-queues.md): the review
    // of a grant they were either side of, and the ruling on a visit of theirs they were not home for.
    db
      .prepare(
        `UPDATE referral_attributions SET review_reason = NULL
         WHERE referred_person_id = ?1 OR code IN (SELECT code FROM referral_codes WHERE person_id = ?1)`,
      )
      .bind(personId),
    // Their first name on a referral, which the referrer's tracker shows until now; blank, it reads "A friend",
    // which says nothing of the erasure (LIFE-13). Counsel may rule it can stay (docs/open-points.md, item 63).
    db
      .prepare("UPDATE referral_attributions SET friend_first_name = NULL WHERE referred_person_id = ?1")
      .bind(personId),
    // And the client's own words to the technician on a visit (src/domain/client-notes.ts).
    db.prepare("UPDATE appointments SET client_note = NULL, client_note_at = NULL WHERE person_id = ?1").bind(personId),
    // Found through the check-in, which each case is keyed on, so the lookup is indexed.
    db
      .prepare(
        `UPDATE no_show_cases SET decision_reason = NULL
         WHERE checkin_id IN (
           SELECT c.id FROM checkins c JOIN appointments a ON a.id = c.appointment_id WHERE a.person_id = ?1)`,
      )
      .bind(personId),
    // The number is replaced, not kept: a later booking from it starts afresh, with a new consent.
    db
      .prepare(
        `UPDATE people SET erased_at = ?2, name = 'Erased', email = NULL, mobile_e164 = 'erased:' || id,
           contactable = 0
         WHERE id = ?1`,
      )
      .bind(personId, at),
    ...withdrawals,
  ];
}

/**
 * An erased person's files: their try-on photographs and results, their visit
 * photographs (docs/decisions/0049-dpdp.md) and their referral card. Each is
 * deleted from R2 before the row that names it, so a run that fails part-way
 * leaves the rest for the next.
 */
async function deleteErasedFiles(env: ErasureEnv, personId: string, now: Date): Promise<void> {
  await deleteTryOnFiles(env, personId, now);
  await deleteVisitPhotos(env, personId);
  await deleteReferralCard(env, personId);
  await env.DB.prepare("UPDATE people SET files_erased_at = ?2 WHERE id = ?1").bind(personId, now.toISOString()).run();
}

async function deleteTryOnFiles(env: ErasureEnv, personId: string, now: Date): Promise<void> {
  const { results: jobs } = await env.DB.prepare(
    "SELECT id, upload_key, upload_deleted_at, result_key FROM tryon_jobs WHERE person_id = ?1",
  )
    .bind(personId)
    .all<{ id: string; upload_key: string; upload_deleted_at: string | null; result_key: string | null }>();
  const photos = jobs.filter((job) => job.upload_deleted_at === null).map((job) => job.upload_key);
  // Both keys a render can store its result under, for a render that stored one after it was read.
  const results = jobs.flatMap((job) => [
    ...(job.result_key === null ? [] : [job.result_key]),
    `results/${job.id}.png`,
    `results/${job.id}.jpg`,
  ]);
  await deleteKeys(env.UPLOADS, photos);
  await deleteKeys(env.RESULTS, results);
  await env.DB.prepare(
    "UPDATE tryon_jobs SET result_key = NULL, upload_deleted_at = COALESCE(upload_deleted_at, ?2) WHERE person_id = ?1",
  )
    .bind(personId, now.toISOString())
    .run();
}

async function deleteVisitPhotos(env: ErasureEnv, personId: string): Promise<void> {
  const db = env.DB;
  const { results: photos } = await db
    .prepare(
      `SELECT ph.r2_key FROM photos ph JOIN photo_sets s ON s.id = ph.photo_set_id
       JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1`,
    )
    .bind(personId)
    .all<{ r2_key: string }>();
  await deleteKeys(
    env.CLIENT_PHOTOS,
    photos.map((photo) => photo.r2_key),
  );
  const theirSets =
    "SELECT s.id FROM photo_sets s JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1";
  // The sets go after their photographs, for the foreign key. An empty set holds no personal data,
  // but it is a record of photographs that no longer exist.
  await db.batch([
    db.prepare(`DELETE FROM photos WHERE photo_set_id IN (${theirSets})`).bind(personId),
    db.prepare(`DELETE FROM photo_sets WHERE id IN (${theirSets})`).bind(personId),
  ]);
}

async function deleteReferralCard(env: ErasureEnv, personId: string): Promise<void> {
  const card = await env.DB.prepare(
    "SELECT code, card_key FROM referral_codes WHERE person_id = ?1 AND card_key IS NOT NULL",
  )
    .bind(personId)
    .first<{ code: string; card_key: string }>();
  if (card === null) return;
  await env.REFERRAL_CARDS.delete(card.card_key);
  await env.DB.prepare("UPDATE referral_codes SET card_key = NULL WHERE code = ?1").bind(card.code).run();
}

async function deleteKeys(bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys)];
  for (let start = 0; start < unique.length; start += R2_DELETE_BATCH) {
    await bucket.delete(unique.slice(start, start + R2_DELETE_BATCH));
  }
}

/** The files an erasure could not delete at the time, a few people a run; the number of people finished. */
export async function deleteLeftFiles(env: ErasureEnv, now: Date, log: Logger): Promise<number> {
  const { results: people } = await env.DB.prepare(
    "SELECT id FROM people WHERE erased_at IS NOT NULL AND files_erased_at IS NULL ORDER BY erased_at LIMIT ?1",
  )
    .bind(LEFT_FILES_PER_RUN)
    .all<{ id: string }>();
  let finished = 0;
  for (const { id } of people) {
    try {
      await deleteErasedFiles(env, id, now);
      finished += 1;
    } catch (error) {
      log.warn("erasure_files_left", { person_id: id, error });
    }
  }
  return finished;
}
