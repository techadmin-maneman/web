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

import { fileExtension, inspectImage } from "../lib/image-bytes.ts";
import { signToken, verifyToken } from "../lib/signed-token.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { Angle, Phase } from "./visit-photos.ts";

/** How long an upload link lasts. */
export const UPLOAD_LINK_TTL_MS = 15 * 60 * 1000;
/** A photograph from a phone, at most. */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

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
): Promise<{ url: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + UPLOAD_LINK_TTL_MS);
  const token = await signToken(secret, "tech_photo", `${slot.appointmentId}:${slot.phase}:${slot.angle}`, expiresAt);
  return { url: `/api/tech/photos/${token}`, expiresAt };
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
  await bucket.put(key, bytes, { httpMetadata: { contentType: info.type } });
  const row = await db
    .prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
       ON CONFLICT (photo_set_id, angle) DO UPDATE SET
         r2_key = excluded.r2_key, content_type = excluded.content_type, bytes = excluded.bytes,
         width = excluded.width, height = excluded.height, taken_at = excluded.taken_at,
         fsm_attachment_id = NULL
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
