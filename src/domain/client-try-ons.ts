// A client's own try-ons, for the client app's Photos tab (docs/decisions/0082-try-ons-in-the-app.md): the
// photograph they uploaded on the site and the look made from it, each only while it is held. A try-on is the
// client's once the site's gate was passed with their number (src/domain/tryon-claims.ts), the number they log in to
// the app with. Every image goes through a link that lasts 15 minutes, and only to that client.
//
// A client's try-on is kept (docs/decisions/0084-a-clients-try-on-is-kept.md): its photograph, as the small copy the
// site sent with it, until they ask us to delete it, and its look until their first fit is photographed. Which try-on
// that is, is src/policy/kept-try-ons.ts.

import { PHOTO_RETENTION_MS, type JobState } from "../config/tryon.ts";
import { indiaDate } from "../lib/india-time.ts";
import { signToken, type TokenPurpose } from "../lib/signed-token.ts";
import { keptTryOn } from "../policy/kept-try-ons.ts";
import { PHOTO_LINK_MS } from "./client-visits.ts";
import { firstFitPhotographed, hasBooked, heldTryOn } from "./kept-try-ons.ts";

export const TRY_ON_IMAGES = ["photo", "look"] as const;
export type TryOnImage = (typeof TRY_ON_IMAGES)[number];

/** Each image's links are signed for their own purpose, so a photograph's link cannot open a look. */
export const TRY_ON_TOKEN_PURPOSES = { photo: "tryon_photo", look: "tryon_look" } as const satisfies Record<
  TryOnImage,
  TokenPurpose
>;

export interface TryOnLink {
  /** Lasts 15 minutes; only the signed-in client can open it. */
  readonly url: string;
  /** When the retention rule lets it go, and the sweeper deletes it soon after; null while it is kept. */
  readonly kept_until: string | null;
}

export interface ClientTryOn {
  readonly id: string;
  /** India's date the look was asked for. */
  readonly made_on: string;
  /** The client's kept try-on: its photograph kept until they ask, its look until their first fit is photographed. */
  readonly kept: boolean;
  readonly photo: TryOnLink | null;
  readonly look: TryOnLink | null;
}

/** The buckets a try-on image may be held in. */
export type TryOnBucket = "UPLOADS" | "RESULTS" | "CLIENT_PHOTOS";

interface Held {
  readonly bucket: TryOnBucket;
  readonly key: string;
  /** Null while it is kept. */
  readonly keptUntil: string | null;
}

/** Whether a try-on is the client's kept one, and whether its look is kept with it. */
interface Keeping {
  readonly kept: boolean;
  readonly lookKept: boolean;
}
const NOT_KEPT: Keeping = { kept: false, lookKept: false };

interface TryOnRow {
  id: string;
  created_at: string;
  upload_key: string;
  uploaded_at: string | null;
  upload_deleted_at: string | null;
  parent_job_id: string | null;
  state: JobState;
  result_key: string | null;
  expires_at: string | null;
  photo_consent_version: string;
  copy_key: string | null;
  kept_at: string | null;
  kept_look_key: string | null;
  /** The last look asked of this photograph, which it is kept an hour after. */
  last_look_at: string;
}

const COLUMNS = `j.id, j.created_at, j.upload_key, j.uploaded_at, j.upload_deleted_at, j.parent_job_id, j.state,
  j.result_key, j.expires_at, j.photo_consent_version, j.copy_key, j.kept_at, j.kept_look_key,
  (SELECT MAX(o.created_at) FROM tryon_jobs o WHERE o.upload_key = j.upload_key) AS last_look_at`;

/** When the sweeper deletes the photograph: an hour after the last look asked of it. Null once it is gone. */
function photoDeletedAt(row: TryOnRow): string | null {
  if (row.uploaded_at === null || row.upload_deleted_at !== null) return null;
  return new Date(Date.parse(row.last_look_at) + PHOTO_RETENTION_MS).toISOString();
}

/** The look's day (src/queues/render.ts), while it is held in the results bucket. */
function lookDay(row: TryOnRow, now: Date): string | null {
  if (row.state !== "ready" || row.result_key === null || row.expires_at === null) return null;
  return row.expires_at > now.toISOString() ? row.expires_at : null;
}

/**
 * The photograph the app shows. Where the site sent a small copy, the copy: kept for a client, and otherwise held as
 * long as the look, or as the photograph while no look is made. Where it did not, the photograph itself, for its
 * hour. A second look of a photograph shows only the look.
 */
function heldPhoto(row: TryOnRow, keeping: Keeping, now: Date): Held | null {
  if (row.parent_job_id !== null) return null;
  const photoUntil = photoDeletedAt(row);
  if (row.copy_key === null) {
    return photoUntil === null ? null : { bucket: "UPLOADS", key: row.upload_key, keptUntil: photoUntil };
  }
  if (keeping.kept) return { bucket: "CLIENT_PHOTOS", key: row.copy_key, keptUntil: null };
  const until = lookDay(row, now) ?? photoUntil;
  return until === null ? null : { bucket: "CLIENT_PHOTOS", key: row.copy_key, keptUntil: until };
}

/** The look: where it is kept for a client, or in the results bucket until its day. */
function heldLook(row: TryOnRow, keeping: Keeping, now: Date): Held | null {
  if (row.kept_look_key !== null) return { bucket: "CLIENT_PHOTOS", key: row.kept_look_key, keptUntil: null };
  const day = lookDay(row, now);
  if (day === null || row.result_key === null) return null;
  return { bucket: "RESULTS", key: row.result_key, keptUntil: keeping.lookKept ? null : day };
}

async function linkTo(
  image: TryOnImage,
  jobId: string,
  held: Held | null,
  signingKey: string,
  now: Date,
): Promise<TryOnLink | null> {
  if (held === null) return null;
  const expiresAt = new Date(now.getTime() + PHOTO_LINK_MS);
  const token = await signToken(signingKey, TRY_ON_TOKEN_PURPOSES[image], jobId, expiresAt);
  return { url: `/api/photos/try-on/${image}/${token}`, kept_until: held.keptUntil };
}

/** The client's kept try-on, if they have one, and whether its look is kept with it. */
async function keptOne(
  db: D1Database,
  personId: string,
  rows: readonly TryOnRow[],
  now: Date,
): Promise<{ readonly id: string | null; readonly lookKept: boolean }> {
  if (rows.length === 0) return { id: null, lookKept: false };
  const id = keptTryOn(rows.map(heldTryOn), await hasBooked(db, personId), now.toISOString());
  if (id === null) return { id: null, lookKept: false };
  return { id, lookKept: !(await firstFitPhotographed(db, personId)) };
}

/**
 * The client's try-ons with a photograph or a look still held, newest first. A render still being made shows its
 * photograph alone. A failed one is left out: no look came of it, and the site asks for another photograph, which
 * is listed in its place.
 */
export async function clientTryOns(
  db: D1Database,
  personId: string,
  signingKey: string,
  now: Date,
): Promise<ClientTryOn[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLUMNS} FROM tryon_jobs j WHERE j.person_id = ?1 AND j.state != 'failed' ORDER BY j.created_at DESC`,
    )
    .bind(personId)
    .all<TryOnRow>();
  const kept = await keptOne(db, personId, results, now);
  const tryOns: ClientTryOn[] = [];
  for (const row of results) {
    const keeping = row.id === kept.id ? { kept: true, lookKept: kept.lookKept } : NOT_KEPT;
    const photo = await linkTo("photo", row.id, heldPhoto(row, keeping, now), signingKey, now);
    const look = await linkTo("look", row.id, heldLook(row, keeping, now), signingKey, now);
    if (photo === null && look === null) continue;
    tryOns.push({ id: row.id, made_on: indiaDate(new Date(row.created_at)), kept: keeping.kept, photo, look });
  }
  return tryOns;
}

/**
 * One of the client's own try-on images while it is held, where it is held, and the day it was made; null for anyone
 * else's. Whether it is held does not wait on the client's booking: until its look's day every image is held, and
 * after it only what the sweeper kept.
 */
export async function ownTryOnImage(
  db: D1Database,
  personId: string,
  jobId: string,
  image: TryOnImage,
  now: Date,
): Promise<{ bucket: TryOnBucket; key: string; madeOn: string } | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM tryon_jobs j WHERE j.id = ?1 AND j.person_id = ?2`)
    .bind(jobId, personId)
    .first<TryOnRow>();
  if (row === null) return null;
  const keeping = { kept: row.kept_at !== null, lookKept: false };
  const held = image === "photo" ? heldPhoto(row, keeping, now) : heldLook(row, keeping, now);
  return held === null ? null : { bucket: held.bucket, key: held.key, madeOn: indiaDate(new Date(row.created_at)) };
}
