// A client's own try-ons, for the client app's Photos tab (docs/decisions/0082-try-ons-in-the-app.md): the
// photograph they uploaded on the site and the look made from it, each only while the try-on's retention rule
// still holds it. A try-on is the client's once the site's gate was passed with their number
// (src/domain/tryon-claims.ts), the number they log in to the app with. Every image goes through a link that
// lasts 15 minutes, and only to that client.

import { PHOTO_RETENTION_MS, type JobState } from "../config/tryon.ts";
import { indiaDate } from "../lib/india-time.ts";
import { signToken, type TokenPurpose } from "../lib/signed-token.ts";
import { PHOTO_LINK_MS } from "./client-visits.ts";

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
  /** When the retention rule lets it go; the sweeper, every five minutes, deletes it soon after. */
  readonly kept_until: string;
}

export interface ClientTryOn {
  readonly id: string;
  /** India's date the look was asked for. */
  readonly made_on: string;
  readonly photo: TryOnLink | null;
  readonly look: TryOnLink | null;
}

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
  /** The last look asked of this photograph, which it is kept an hour after. */
  last_look_at: string;
}

const COLUMNS = `j.id, j.created_at, j.upload_key, j.uploaded_at, j.upload_deleted_at, j.parent_job_id, j.state,
  j.result_key, j.expires_at, (SELECT MAX(o.created_at) FROM tryon_jobs o WHERE o.upload_key = j.upload_key) AS last_look_at`;

/**
 * Until when the photograph is held: the sweeper deletes it an hour after the last look asked of it
 * (src/scheduled/sweeper.ts), and an erasure at once. A second look of a photograph shows only the look, so the
 * photograph is shown once, beside its first.
 */
function photoKeptUntil(row: TryOnRow): string | null {
  if (row.parent_job_id !== null || row.uploaded_at === null || row.upload_deleted_at !== null) return null;
  return new Date(Date.parse(row.last_look_at) + PHOTO_RETENTION_MS).toISOString();
}

/** Until when the look is held: from when it is made to the day it expires (src/queues/render.ts), or an erasure. */
function lookKeptUntil(row: TryOnRow, now: Date): string | null {
  if (row.state !== "ready" || row.result_key === null || row.expires_at === null) return null;
  return row.expires_at > now.toISOString() ? row.expires_at : null;
}

async function linkTo(
  image: TryOnImage,
  jobId: string,
  keptUntil: string | null,
  signingKey: string,
  now: Date,
): Promise<TryOnLink | null> {
  if (keptUntil === null) return null;
  const expiresAt = new Date(now.getTime() + PHOTO_LINK_MS);
  const token = await signToken(signingKey, TRY_ON_TOKEN_PURPOSES[image], jobId, expiresAt);
  return { url: `/api/photos/try-on/${image}/${token}`, kept_until: keptUntil };
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
  const tryOns: ClientTryOn[] = [];
  for (const row of results) {
    const photo = await linkTo("photo", row.id, photoKeptUntil(row), signingKey, now);
    const look = await linkTo("look", row.id, lookKeptUntil(row, now), signingKey, now);
    if (photo === null && look === null) continue;
    tryOns.push({ id: row.id, made_on: indiaDate(new Date(row.created_at)), photo, look });
  }
  return tryOns;
}

/** One of the client's own try-on images while it is held, and the day it was made; null for anyone else's. */
export async function ownTryOnImage(
  db: D1Database,
  personId: string,
  jobId: string,
  image: TryOnImage,
  now: Date,
): Promise<{ key: string; madeOn: string } | null> {
  const row = await db
    .prepare(`SELECT ${COLUMNS} FROM tryon_jobs j WHERE j.id = ?1 AND j.person_id = ?2`)
    .bind(jobId, personId)
    .first<TryOnRow>();
  if (row === null) return null;
  const key = image === "photo" ? heldPhotoKey(row) : heldLookKey(row, now);
  return key === null ? null : { key, madeOn: indiaDate(new Date(row.created_at)) };
}

const heldPhotoKey = (row: TryOnRow) => (photoKeptUntil(row) === null ? null : row.upload_key);
const heldLookKey = (row: TryOnRow, now: Date) => (lookKeptUntil(row, now) === null ? null : row.result_key);
