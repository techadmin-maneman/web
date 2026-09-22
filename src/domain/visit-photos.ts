// A visit's photographs, from FSM into the client-photos bucket
// (docs/decisions/0032-fsm-mirror.md). While technicians photograph in FSM's
// own app, a photograph says its phase and angle by its file name, e.g.
// "before-front.jpg" or "after hair.jpg". Other attachments are left alone.
// The newest file for an angle is the visit's photograph. One it replaces
// stays in the bucket, under the visit's prefix, since a photograph is only
// ever deleted on purpose and audited; an erasure finds it there.

import { fileExtension, inspectImage } from "../lib/image-bytes.ts";
import type { FsmAttachment, FsmProvider } from "../providers/fsm.ts";

export const PHASES = ["before", "after"] as const;
export const ANGLES = ["front", "top", "left", "right", "hair"] as const;
export type Phase = (typeof PHASES)[number];
export type Angle = (typeof ANGLES)[number];

/** A full set: five angles, before and after. */
export const PHOTOS_PER_VISIT = PHASES.length * ANGLES.length;

const PHOTO_NAME = /^(before|after)[-_ ](front|top|left|right|hair)\.[a-z0-9]+$/i;

/** The phase and angle a file's name gives, or null for any other file. */
export function photoSlot(fileName: string): { phase: Phase; angle: Angle } | null {
  const match = PHOTO_NAME.exec(fileName.trim());
  if (match === null) return null;
  return { phase: match[1]?.toLowerCase() as Phase, angle: match[2]?.toLowerCase() as Angle };
}

export interface ExportResult {
  readonly exported: number;
  /** Photographs whose bytes were not a JPEG or PNG. */
  readonly unreadable: number;
}

/** Copies an appointment's new photographs from FSM. Does nothing once its set is complete. */
export async function exportVisitPhotos(
  db: D1Database,
  bucket: R2Bucket,
  fsm: FsmProvider,
  appointment: { id: string; fsmId: string },
  now: Date,
): Promise<ExportResult> {
  const { results } = await db
    .prepare(
      `SELECT s.phase, p.angle, p.taken_at, p.fsm_attachment_id
       FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id = ?1`,
    )
    .bind(appointment.id)
    .all<{ phase: Phase; angle: Angle; taken_at: string; fsm_attachment_id: string | null }>();
  if (results.length >= PHOTOS_PER_VISIT) return { exported: 0, unreadable: 0 };
  /** When each slot's photograph was taken: a file no newer than it is an earlier take. */
  const takenAt = new Map(results.map((row) => [`${row.phase}-${row.angle}`, row.taken_at]));
  const known = new Set(results.map((row) => row.fsm_attachment_id));

  const files = (await fsm.attachments(appointment.fsmId))
    .filter((file) => !known.has(file.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let exported = 0;
  let unreadable = 0;
  for (const file of files) {
    const slot = photoSlot(file.name);
    if (slot === null) continue;
    const taken = new Date(file.createdAt).toISOString();
    const held = takenAt.get(`${slot.phase}-${slot.angle}`);
    if (held !== undefined && held >= taken) continue;
    if (await storePhoto(db, bucket, fsm, appointment.id, file, slot, taken, now)) {
      takenAt.set(`${slot.phase}-${slot.angle}`, taken);
      exported += 1;
    } else {
      unreadable += 1;
    }
  }
  return { exported, unreadable };
}

/** Stores one photograph in its slot. False when its bytes are not a JPEG or PNG. */
async function storePhoto(
  db: D1Database,
  bucket: R2Bucket,
  fsm: FsmProvider,
  appointmentId: string,
  file: FsmAttachment,
  slot: { phase: Phase; angle: Angle },
  takenAt: string,
  now: Date,
): Promise<boolean> {
  const download = await fsm.download(file.fileId);
  const bytes = new Uint8Array(await new Response(download.body).arrayBuffer());
  const info = inspectImage(bytes);
  if (info === null) return false;

  const at = now.toISOString();
  await db
    .prepare(
      `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (appointment_id, phase) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), appointmentId, slot.phase, at)
    .run();
  const set = await db
    .prepare("SELECT id FROM photo_sets WHERE appointment_id = ?1 AND phase = ?2")
    .bind(appointmentId, slot.phase)
    .first<{ id: string }>();
  if (set === null) throw new Error("the photo set was not written");

  const key = `visits/${appointmentId}/${slot.phase}-${slot.angle}-${file.id}.${fileExtension(info.type)}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: info.type } });
  await db
    .prepare(
      `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, width, height, taken_at, fsm_attachment_id, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (photo_set_id, angle) DO UPDATE SET
         r2_key = excluded.r2_key, content_type = excluded.content_type, bytes = excluded.bytes,
         width = excluded.width, height = excluded.height, taken_at = excluded.taken_at,
         fsm_attachment_id = excluded.fsm_attachment_id`,
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
      takenAt,
      file.id,
      at,
    )
    .run();
  return true;
}
