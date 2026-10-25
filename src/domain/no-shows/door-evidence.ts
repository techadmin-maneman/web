// What a technician adds at the door when nobody answers (migration 0194): a short note, and one photograph of the
// door, uploaded to a link signed for the visit before the no-show is sent, and kept with the case ops rule on. The
// photograph is under the visit's own folder in R2, so an erasure deletes it with the visit's photographs
// (../privacy/erasure-files.ts).

import { MINUTE_MS } from "../../lib/durations.ts";
import { inspectImage } from "../../lib/image-bytes.ts";
import { signToken, verifyToken, type SigningSecret } from "../../lib/signed-token.ts";
import { putCounted } from "../platform/storage-meter.ts";

/** How long an upload link lasts. */
const LINK_TTL_MS = 15 * MINUTE_MS;

/** Where a take of the visit's door photograph is kept. */
const doorPhotoKey = (appointmentId: string, take: string): string => `visits/${appointmentId}/door-${take}`;

/** The path the phone PUTs the door photograph to, signed for the visit. */
export async function doorUploadLink(
  secret: SigningSecret,
  appointmentId: string,
  now: Date,
): Promise<{ url: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + LINK_TTL_MS);
  const token = await signToken(secret, "door_photo", appointmentId, expiresAt);
  return { url: `/api/tech/door-photos/${token}`, expiresAt };
}

/** The visit a door photograph's link names; null for any link this server did not sign, or one expired. */
export const visitOfDoorLink = (secret: SigningSecret, token: string, now: Date): Promise<string | null> =>
  verifyToken(secret, "door_photo", token, now);

/** Puts the photograph in R2 under a take of its own, which the no-show then names; null for bytes not an image. */
export async function storeDoorPhoto(input: {
  db: D1Database;
  bucket: R2Bucket;
  appointmentId: string;
  bytes: Uint8Array;
}): Promise<string | null> {
  const info = inspectImage(input.bytes);
  if (info === null) return null;
  const take = crypto.randomUUID();
  const key = doorPhotoKey(input.appointmentId, take);
  await putCounted({ db: input.db, bucket: input.bucket, key, bytes: input.bytes, contentType: info.type });
  return take;
}

/**
 * The note and the photograph, kept with the case. A photograph is named only where its take is in R2 under the
 * visit, so a take from another visit, or one that never arrived, names nothing.
 */
export async function keepDoorEvidence(input: {
  db: D1Database;
  bucket: R2Bucket;
  caseId: string;
  appointmentId: string;
  note: string | undefined;
  take: string | undefined;
}): Promise<void> {
  const key = input.take === undefined ? null : doorPhotoKey(input.appointmentId, input.take);
  const held = key === null ? null : await input.bucket.head(key);
  if (input.note === undefined && held === null) return;
  await input.db
    .prepare(
      `UPDATE no_show_cases SET door_note = COALESCE(?2, door_note), door_photo_key = COALESCE(?3, door_photo_key)
       WHERE id = ?1`,
    )
    .bind(input.caseId, input.note ?? null, held === null ? null : key)
    .run();
}
