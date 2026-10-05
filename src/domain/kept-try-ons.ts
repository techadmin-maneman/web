// A client's try-on, kept (docs/decisions/0084-a-clients-try-on-is-kept.md). Which try-on is kept is
// src/policy/kept-try-ons.ts; this reads the facts it is decided on, keeps a try-on on its look's last day, and lets
// the kept look go once the client's first fit is photographed. The sweeper runs both (src/scheduled/sweeper.ts).
//
// What is kept lives in the client-photos bucket, which has no lifecycle rule: the small copy from its upload, and the
// look once it is moved there from the results bucket, whose 30-day rule would otherwise take it.

import { KEEPING_NOTICES, keptTryOn, type HeldTryOn } from "../policy/kept-try-ons.ts";
import { DAY_MS } from "../lib/durations.ts";
import { fileExtension, type ImageType } from "../lib/image-bytes.ts";
import type { JobState } from "../config/tryon.ts";
import { deleteCounted, putCounted } from "./storage-meter.ts";

type KeepEnv = Pick<Env, "DB" | "RESULTS" | "CLIENT_PHOTOS">;

/** Where a try-on's small copy is kept in the client-photos bucket. */
export const copyKey = (jobId: string) => `tryons/${jobId}/before.jpg`;
/** Where its look is kept, by the look's own type. */
export const keptLookKey = (jobId: string, type: ImageType) => `tryons/${jobId}/look.${fileExtension(type)}`;

/** First-fit photographs stored this long ago or less are looked for on each run; the reconciliation's is three days. */
const FIRST_FITS_SINCE_MS = 3 * DAY_MS;
/** Most kept looks let go in one run; the next run takes the rest. */
const BATCH_LIMIT = 100;

/** Whether the person has booked a visit of any kind: a visit of theirs in the diary, or one the site's forms took. */
export async function hasBooked(db: D1Database, personId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM appointments WHERE person_id = ?1)
         OR EXISTS (SELECT 1 FROM leads WHERE person_id = ?1 AND source = 'form') AS booked`,
    )
    .bind(personId)
    .first<{ booked: number }>();
  return row?.booked === 1;
}

/** Whether a photograph of the person's first fit is stored. */
export async function firstFitPhotographed(db: D1Database, personId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM appointments a
       JOIN photo_sets s ON s.appointment_id = a.id JOIN photos p ON p.photo_set_id = s.id
       WHERE a.person_id = ?1 AND a.type = 'first_fit' LIMIT 1`,
    )
    .bind(personId)
    .first();
  return row !== null;
}

interface TryOnFacts {
  readonly id: string;
  readonly created_at: string;
  readonly photo_consent_version: string;
  readonly state: JobState;
  readonly result_key: string | null;
  readonly expires_at: string | null;
  readonly kept_at: string | null;
}

/** A try-on as the policy weighs it: its look is held until its day, once it is made. */
export function heldTryOn(tryOn: TryOnFacts): HeldTryOn {
  const lookMade = tryOn.state === "ready" && tryOn.result_key !== null;
  return {
    id: tryOn.id,
    createdAt: tryOn.created_at,
    photoConsentVersion: tryOn.photo_consent_version,
    keptAt: tryOn.kept_at,
    lookHeldUntil: lookMade ? tryOn.expires_at : null,
  };
}

export interface ExpiringTryOn extends TryOnFacts {
  readonly person_id: string | null;
  /** Null for a claim whose number no code proved, which may have been anyone's: it is never kept. */
  readonly number_proved_at: string | null;
  readonly copy_key: string | null;
  readonly kept_look_key: string | null;
}

/**
 * Looks on their last day. A client's try-on is kept; every other's small copy goes, as its look does, which the
 * sweeper deletes after this. How many were kept.
 */
export async function keepOrLetGo(env: KeepEnv, tryOns: readonly ExpiringTryOn[], now: Date): Promise<number> {
  const letGo: ExpiringTryOn[] = [];
  for (const tryOn of tryOns) {
    if (!(await keepOnItsDay(env, tryOn, now))) letGo.push(tryOn);
  }
  const copies = letGo.flatMap((tryOn) => (tryOn.copy_key === null ? [] : [{ id: tryOn.id, key: tryOn.copy_key }]));
  if (copies.length > 0) {
    await deleteCounted(
      env.DB,
      env.CLIENT_PHOTOS,
      copies.map((copy) => copy.key),
    );
    await env.DB.prepare("UPDATE tryon_jobs SET copy_key = NULL WHERE id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(copies.map((copy) => copy.id)))
      .run();
  }
  return tryOns.length - letGo.length;
}

/**
 * A look on its last day. A client's try-on is kept: its copy stays, and unless their first fit is photographed
 * already its look is moved to the client-photos bucket. One whose look is gone is let go, so a later one can be kept.
 * Whether it was kept.
 */
async function keepOnItsDay(env: KeepEnv, tryOn: ExpiringTryOn, now: Date): Promise<boolean> {
  const { person_id: personId, expires_at: lastDay } = tryOn;
  if (personId === null || lastDay === null || tryOn.number_proved_at === null) return false;
  // Agreed to under a notice that does not keep it, it goes on its day, as that notice said.
  if (!KEEPING_NOTICES.includes(tryOn.photo_consent_version)) return false;
  const db = env.DB;

  const { results: theirs } = await db
    .prepare(
      `SELECT id, created_at, photo_consent_version, state, result_key, expires_at, kept_at
       FROM tryon_jobs WHERE person_id = ?1 AND number_proved_at IS NOT NULL`,
    )
    .bind(personId)
    .all<TryOnFacts>();
  const kept = keptTryOn(theirs.map(heldTryOn), await hasBooked(db, personId), lastDay);
  if (kept !== tryOn.id) return false;

  // A second sweep of the same day finds it kept already; no other of the person's may be (migration 0045).
  const claimed = await db
    .prepare(
      `UPDATE tryon_jobs SET kept_at = COALESCE(kept_at, ?2)
       WHERE id = ?1 AND NOT EXISTS (
         SELECT 1 FROM tryon_jobs k WHERE k.person_id = ?3 AND k.kept_at IS NOT NULL AND k.id != ?1)
       RETURNING id`,
    )
    .bind(tryOn.id, now.toISOString(), personId)
    .first();
  if (claimed === null) return false;
  // Kept on an earlier run that stopped before the try-on was expired: its look was moved then.
  if (tryOn.kept_look_key !== null) return true;
  if (await firstFitPhotographed(db, personId)) return true;

  const look = tryOn.result_key === null ? null : await env.RESULTS.get(tryOn.result_key);
  if (look === null) {
    await db.prepare("UPDATE tryon_jobs SET kept_at = NULL WHERE id = ?1").bind(tryOn.id).run();
    return false;
  }
  const type: ImageType = look.httpMetadata?.contentType === "image/png" ? "image/png" : "image/jpeg";
  const key = keptLookKey(tryOn.id, type);
  await putCounted(db, env.CLIENT_PHOTOS, key, await look.arrayBuffer(), type);
  await db.prepare("UPDATE tryon_jobs SET kept_look_key = ?2 WHERE id = ?1").bind(tryOn.id, key).run();
  return true;
}

/**
 * The small copies of photographs the sweeper has just deleted, deleted with them: all but those of a try-on kept, or
 * claimed with its look, which are held as long as the look.
 */
export async function letCopiesGoWith(env: KeepEnv, uploadKeys: readonly string[]): Promise<void> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT id, copy_key FROM tryon_jobs
       WHERE upload_key IN (SELECT value FROM json_each(?1)) AND copy_key IS NOT NULL
         AND kept_at IS NULL AND NOT (person_id IS NOT NULL AND state = 'ready')`,
    )
    .bind(JSON.stringify(uploadKeys))
    .all<{ id: string; copy_key: string }>();
  if (results.length === 0) return;

  await deleteCounted(
    db,
    env.CLIENT_PHOTOS,
    results.map((row) => row.copy_key),
  );
  await db
    .prepare("UPDATE tryon_jobs SET copy_key = NULL WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(results.map((row) => row.id)))
    .run();
}

/**
 * The kept looks of clients whose first fit has been photographed, deleted. Each run looks at the first-fit sets
 * photographed in the last three days, not at every kept look: those wait for a first fit that may never come.
 */
export async function letFittedLooksGo(env: KeepEnv, now: Date): Promise<number> {
  const db = env.DB;
  const { results } = await db
    .prepare(
      `SELECT j.id, j.kept_look_key FROM tryon_jobs j
       WHERE j.kept_at IS NOT NULL AND j.kept_look_key IS NOT NULL AND j.person_id IN (
         SELECT a.person_id FROM photo_sets s JOIN appointments a ON a.id = s.appointment_id
         WHERE s.created_at > ?1 AND a.type = 'first_fit'
           AND EXISTS (SELECT 1 FROM photos p WHERE p.photo_set_id = s.id))
       LIMIT ?2`,
    )
    .bind(new Date(now.getTime() - FIRST_FITS_SINCE_MS).toISOString(), BATCH_LIMIT)
    .all<{ id: string; kept_look_key: string }>();
  if (results.length === 0) return 0;

  await deleteCounted(
    db,
    env.CLIENT_PHOTOS,
    results.map((row) => row.kept_look_key),
  );
  await db
    .prepare("UPDATE tryon_jobs SET kept_look_key = NULL WHERE id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(results.map((row) => row.id)))
    .run();
  return results.length;
}
