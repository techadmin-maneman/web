// An erased person's files deleted from R2 (./erasure.ts): their try-ons, their visits' photographs and their
// referral card, each before the row that names it; and, by the cron, what a failed run left.

import type { Logger } from "../../log.ts";
import { deleteCounted, deleteUnder } from "../platform/storage-meter.ts";
import { copyKey, keptLookKey } from "../try-on/kept-try-ons.ts";

/** R2 deletes at most 1,000 keys a call. */
const R2_DELETE_BATCH = 1000;
/**
 * Most erased people whose files one cron run finishes. Each costs about fifteen calls to D1 and R2 and one list for
 * each of their visits, and a run shares Cloudflare's 1,000 such calls an invocation with every other cron job: five
 * clients of five years' monthly visits come to under 400.
 */
const LEFT_FILES_PER_RUN = 5;
export type ErasureEnv = Pick<Env, "DB" | "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS" | "REFERRAL_CARDS">;
/**
 * An erased person's files: their try-on photographs, results, small copies and kept looks, their visit
 * photographs (docs/decisions/0049-dpdp.md) and their referral card. Each is
 * deleted from R2 before the row that names it, so a run that fails part-way
 * leaves the rest for the next.
 */
export async function deleteErasedFiles(env: ErasureEnv, personId: string, now: Date): Promise<void> {
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
  // A client's kept copy and look (docs/decisions/0084-a-clients-try-on-is-kept.md), under every key either can
  // have, for a sweep that stored one and was stopped before it said so.
  const kept = jobs.flatMap((job) => [
    copyKey(job.id),
    keptLookKey(job.id, "image/png"),
    keptLookKey(job.id, "image/jpeg"),
  ]);
  await deleteKeys(env.UPLOADS, photos);
  await deleteKeys(env.RESULTS, results);
  await deleteCounted(env.DB, env.CLIENT_PHOTOS, kept);
  await env.DB.prepare(
    `UPDATE tryon_jobs SET result_key = NULL, upload_deleted_at = COALESCE(upload_deleted_at, ?2), copy_key = NULL,
       kept_look_key = NULL
     WHERE person_id = ?1`,
  )
    .bind(personId, now.toISOString())
    .run();
}

/**
 * Every photograph and thumbnail the person's rows name, and everything else under each of their visits in the
 * bucket: a photograph taken again at the same angle, which no row names any more
 * (docs/decisions/0028-photographs-from-the-app.md), and its thumbnail. One list a visit, then one delete for each
 * thousand keys and two updates of the storage meter, however many visits there were.
 */
async function deleteVisitPhotos(env: ErasureEnv, personId: string): Promise<void> {
  const db = env.DB;
  const { results: photos } = await db
    .prepare(
      `SELECT s.appointment_id, ph.r2_key, ph.thumbnail_key FROM photos ph JOIN photo_sets s ON s.id = ph.photo_set_id
       JOIN appointments a ON a.id = s.appointment_id WHERE a.person_id = ?1`,
    )
    .bind(personId)
    .all<{ appointment_id: string; r2_key: string; thumbnail_key: string | null }>();
  // A row may name a key outside its visit's prefix, as older records and the browser tests' seed do.
  const named = photos.flatMap((photo) => [
    photo.r2_key,
    ...(photo.thumbnail_key === null ? [] : [photo.thumbnail_key]),
  ]);
  await deleteCounted(db, env.CLIENT_PHOTOS, named);
  const visits = new Set(photos.map((photo) => photo.appointment_id));
  await deleteUnder(
    db,
    env.CLIENT_PHOTOS,
    [...visits].map((visit) => `visits/${visit}/`),
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
  await deleteCounted(env.DB, env.REFERRAL_CARDS, [card.card_key]);
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
