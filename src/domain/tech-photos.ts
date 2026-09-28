// The technician's photographs (docs/decisions/0028-photographs-from-the-app.md).
//
// "Captured in our app, stored in mm-{env}-client-photos. Also attached to the
// FSM job sheet, so FSM stays the complete record." The bytes come through this
// API, never straight to R2, and land in the same bucket under the same prefix
// as the ones the mirror exports from FSM: one visit's photographs are one set
// however they were taken.
//
// The link the app uploads to is a signed path on this host, good for fifteen
// minutes and for one phase and angle. Each angle's latest upload is the
// visit's photograph for that angle; the one it replaces stays in the bucket,
// as a photograph is deleted only on purpose and audited.
//
// The phone also makes a small copy of each photograph for the client app's
// rows, and PUTs it to the same link's /small once the photograph is in
// (docs/decisions/0093-the-storage-meter.md). It is kept beside the photograph,
// and a photograph taken again forgets it, so a row never shows another take's
// copy. A photograph with none, such as one copied from FSM, is shown itself.

import { fileExtension, inspectImage } from "../lib/image-bytes.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { deleteCounted, putCounted } from "./storage-meter.ts";
import type { Angle, Phase } from "./visit-photos.ts";
import { MINUTE_MS } from "../lib/durations.ts";

/** How long an upload link lasts. */
export const PHOTO_UPLOAD_LINK_TTL_MS = 15 * MINUTE_MS;
/**
 * A photograph from the technician's phone, at most. The app sends about 250 KB, and when a frame will not come down
 * to that it sends the smallest it tried, 900 px on its long side at its lowest quality, well under 1 MB even from a
 * phone that ignores the quality it is asked for. Twice that leaves room for such a phone, and keeps a broken build
 * or a misused link from spending R2 at 12 MB a time, as the limit once allowed (docs/decisions/0093). A photograph
 * copied from FSM keeps FSM's size and does not come through here (src/domain/visit-photos.ts).
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/**
 * A photograph's small copy, at most. The phone draws it 300 px on its short side, enough to fill the client app's
 * rows at three device pixels to one, and encodes it to about 32 KB (@maneman/web-kit/small-jpeg).
 */
export const MAX_THUMBNAIL_BYTES = 64 * 1024;
const THUMBNAIL_MAX_SIDE_PX = 800;

export interface PhotoSlot {
  readonly appointmentId: string;
  readonly phase: Phase;
  readonly angle: Angle;
}

/** The path the app PUTs the bytes to, signed for one slot of one job. */
export async function uploadLink(
  secret: string,
  slot: PhotoSlot,
  now: Date,
): Promise<{ url: string; smallUrl: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + PHOTO_UPLOAD_LINK_TTL_MS);
  const token = await signToken(secret, "tech_photo", `${slot.appointmentId}:${slot.phase}:${slot.angle}`, expiresAt);
  const url = `/api/tech/photos/${token}`;
  return { url, smallUrl: `${url}/small`, expiresAt };
}

/** The slot a link names, or null when the token is wrong, forged or expired. */
export async function slotOfLink(secret: string, token: string, now: Date): Promise<PhotoSlot | null> {
  const subject = await verifyToken(secret, "tech_photo", token, now);
  if (subject === null) return null;
  const [appointmentId, phase, angle, ...rest] = subject.split(":");
  if (appointmentId === undefined || phase === undefined || angle === undefined || rest.length > 0) return null;
  return { appointmentId, phase: phase as Phase, angle: angle as Angle };
}

export type Stored =
  | { readonly kind: "stored"; readonly photoId: string; readonly width: number | null; readonly height: number | null }
  | { readonly kind: "not_an_image" };

/** Puts one photograph in its slot: R2 first, then the row that names it. */
export async function storeTechnicianPhoto(
  db: D1Database,
  bucket: R2Bucket,
  slot: PhotoSlot,
  bytes: Uint8Array,
  takenAt: Date,
  now: Date,
): Promise<Stored> {
  const info = inspectImage(bytes);
  if (info === null) return { kind: "not_an_image" };

  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (appointment_id, phase) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), slot.appointmentId, slot.phase, at)
    .run();
  const set = await db
    .prepare("SELECT id FROM photo_sets WHERE appointment_id = ?1 AND phase = ?2")
    .bind(slot.appointmentId, slot.phase)
    .first<{ id: string }>();
  if (set === null) throw new Error("the photo set was not written");

  const key = `visits/${slot.appointmentId}/${slot.phase}-${slot.angle}-${crypto.randomUUID()}.${fileExtension(info.type)}`;
  await putCounted(db, bucket, key, bytes, info.type);
  const row = await db
    .prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (photo_set_id, angle) DO UPDATE SET
         r2_key = excluded.r2_key, content_type = excluded.content_type, bytes = excluded.bytes,
         width = excluded.width, height = excluded.height, taken_at = excluded.taken_at,
         fsm_attachment_id = NULL, thumbnail_key = NULL
       RETURNING id`,
    )
    .bind(
      crypto.randomUUID(),
      set.id,
      slot.angle,
      key,
      info.type,
      bytes.byteLength,
      info.width,
      info.height,
      takenAt.toISOString(),
      at,
    )
    .first<{ id: string }>();
  if (row === null) throw new Error("the photograph was not written");
  return { kind: "stored", photoId: row.id, width: info.width, height: info.height };
}

/** A JPEG no larger than a small copy needs to be, in bytes and in pixels. */
function isThumbnail(bytes: Uint8Array): boolean {
  if (bytes.byteLength > MAX_THUMBNAIL_BYTES) return false;
  const info = inspectImage(bytes);
  if (info?.type !== "image/jpeg" || info.width === null || info.height === null) return false;
  return Math.max(info.width, info.height) <= THUMBNAIL_MAX_SIDE_PX;
}

export type StoredThumbnail = "stored" | "held_already" | "no_photograph" | "not_a_thumbnail";

/** Keeps a photograph's small copy beside it. The photograph comes first: a small copy is never held without one. */
export async function storeThumbnail(
  db: D1Database,
  bucket: R2Bucket,
  slot: PhotoSlot,
  bytes: Uint8Array,
): Promise<StoredThumbnail> {
  if (!isThumbnail(bytes)) return "not_a_thumbnail";
  const photo = await db
    .prepare(
      `SELECT p.id, p.r2_key, p.thumbnail_key FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = ?2 AND p.angle = ?3`,
    )
    .bind(slot.appointmentId, slot.phase, slot.angle)
    .first<{ id: string; r2_key: string; thumbnail_key: string | null }>();
  if (photo === null) return "no_photograph";
  if (photo.thumbnail_key !== null) return "held_already";

  const key = `visits/${slot.appointmentId}/${slot.phase}-${slot.angle}-${crypto.randomUUID()}-small.jpg`;
  await putCounted(db, bucket, key, bytes, "image/jpeg");
  const claimed = await db
    .prepare(
      "UPDATE photos SET thumbnail_key = ?3 WHERE id = ?1 AND r2_key = ?2 AND thumbnail_key IS NULL RETURNING id",
    )
    .bind(photo.id, photo.r2_key, key)
    .first();
  // The photograph was taken again meanwhile, or the same copy arrived twice at once: this one is not needed.
  if (claimed === null) await deleteCounted(db, bucket, [key]);
  return "stored";
}

/** Which angles of a phase this job already holds. */
export async function anglesHeld(db: D1Database, appointmentId: string, phase: Phase): Promise<Angle[]> {
  const { results } = await db
    .prepare(
      `SELECT p.angle FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = ?2`,
    )
    .bind(appointmentId, phase)
    .all<{ angle: Angle }>();
  return results.map((row) => row.angle);
}

/**
 * Attaches to FSM every photograph of a phase that is not there yet, so FSM
 * holds the complete record. The file name carries the phase and angle, which
 * is what the mirror's own export reads back, so a photograph attached here is
 * never exported again as a new one.
 *
 * An attach whose answer never reached us left the file in FSM: a retry finds
 * it by its name and size and keeps its ID, rather than attaching it twice. A
 * photograph taken again at the same angle has other bytes, and is attached.
 */
export async function attachPhotosToFsm(
  db: D1Database,
  bucket: R2Bucket,
  fsm: FsmProvider,
  job: { id: string; fsmId: string },
  phase: Phase,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.angle, p.r2_key, p.content_type FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = ?2 AND p.fsm_attachment_id IS NULL`,
    )
    .bind(job.id, phase)
    .all<{ id: string; angle: Angle; r2_key: string; content_type: string }>();

  if (results.length === 0) return 0;
  const inFsm = await fsm.attachments(job.fsmId);

  let attached = 0;
  for (const photo of results) {
    const object = await bucket.get(photo.r2_key);
    if (object === null) continue;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const name = `${phase}-${photo.angle}.${photo.content_type === "image/png" ? "png" : "jpg"}`;
    const found = inFsm.find((file) => file.name === name && file.size === bytes.byteLength);
    const attachmentId =
      found?.id ?? (await fsm.attachToAppointment(job.fsmId, { name, bytes, contentType: photo.content_type }));
    await db.prepare("UPDATE photos SET fsm_attachment_id = ?2 WHERE id = ?1").bind(photo.id, attachmentId).run();
    attached += 1;
  }
  return attached;
}
