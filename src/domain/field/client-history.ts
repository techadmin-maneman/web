// A client's history, as the technician's Client history screen shows it (docs/decisions/0242-client-record.md): every
// visit of theirs closed before the job open on the phone, newest first, each with who did it, how it closed, the note
// left for the next technician, its after photographs, what was used and the piece fitted. It belongs to the client,
// so a job given to another technician brings it along.

import type { VisitType } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { firstNameOf } from "../../lib/names.ts";
import { stateOf } from "./tech-jobs.ts";
import { statusIn, VISIT_ENDED } from "../../config/statuses.ts";

/** The front first, then the other angles in the order they are taken. */
const ANGLE_ORDER =
  "CASE p.angle WHEN 'front' THEN 0 WHEN 'top' THEN 1 WHEN 'left' THEN 2 WHEN 'right' THEN 3 ELSE 4 END";

/** An after photograph, by the address the phone fetches it at through the job open on it. */
export interface HistoryPhoto {
  readonly angle: string;
  readonly url: string;
}

const photoUrl = (jobId: string, photoId: string): string => `/api/tech/jobs/${jobId}/history-photos/${photoId}`;

export interface HistoryVisit {
  readonly id: string;
  /** Its day in India. */
  readonly date: string;
  readonly type: VisitType;
  /** Who did it, by first name. */
  readonly technician: string | null;
  /** How it closed: done, partial or no_show; null where no outcome landed, as a visit closed by ops. */
  readonly result: string | null;
  /** The note its technician left for the next. */
  readonly note: string | null;
  readonly photos: HistoryPhoto[];
  readonly consumables: { readonly name: string; readonly quantity: number }[];
  /** The label of the piece its last piece step fitted. */
  readonly piece: string | null;
}

interface VisitRow {
  id: string;
  window_start: string;
  type: VisitType;
  technician: string | null;
}

/** How many of the client's visits closed before the job, and the day in India of the first, as the job's row says. */
export interface HistoryCount {
  readonly count: number;
  readonly first: string | null;
}

/** The client's visits closed before the job, counted, as the history lists them; for "5 visits since Jul". */
export async function historyCountOf(
  db: D1Database,
  job: { readonly id: string; readonly personId: string; readonly startsAt: string },
): Promise<HistoryCount> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(a.window_start) AS first FROM appointments a
       WHERE a.person_id = ?1 AND a.id <> ?2 AND a.deleted_at IS NULL AND a.window_start < ?3
         AND ${statusIn("a.status", VISIT_ENDED)}`,
    )
    .bind(job.personId, job.id, job.startsAt)
    .first<{ count: number; first: string | null }>();
  const first = row?.first ?? null;
  return { count: row?.count ?? 0, first: first === null ? null : indiaDate(new Date(first)) };
}

/** The client's visits closed before the job, newest first, each as the history shows it. */
export async function clientHistory(
  db: D1Database,
  job: { readonly id: string; readonly personId: string; readonly startsAt: string },
): Promise<HistoryVisit[]> {
  const { results: visits } = await db
    .prepare(
      `SELECT a.id, a.window_start, a.type, t.name AS technician FROM appointments a
       LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.person_id = ?1 AND a.id <> ?2 AND a.deleted_at IS NULL AND a.window_start < ?3
         AND ${statusIn("a.status", VISIT_ENDED)}
       ORDER BY a.window_start DESC`,
    )
    .bind(job.personId, job.id, job.startsAt)
    .all<VisitRow>();
  if (visits.length === 0) return [];
  const ids = JSON.stringify(visits.map((visit) => visit.id));
  const [events, notes, photos, used, pieces] = await db.batch([
    db
      .prepare(
        `SELECT appointment_id, kind, body, occurred_at FROM job_events
         WHERE appointment_id IN (SELECT value FROM json_each(?1)) AND superseded = 0 AND kind IN ('start', 'outcome')
         ORDER BY received_at, rowid`,
      )
      .bind(ids),
    db
      .prepare(
        "SELECT appointment_id, body FROM handoff_notes WHERE appointment_id IN (SELECT value FROM json_each(?1))",
      )
      .bind(ids),
    db
      .prepare(
        `SELECT s.appointment_id, p.id, p.angle FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
         WHERE s.appointment_id IN (SELECT value FROM json_each(?1)) AND s.phase = 'after' ORDER BY ${ANGLE_ORDER}`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT u.appointment_id, u.name, u.quantity FROM consumables_used u
         WHERE u.appointment_id IN (SELECT value FROM json_each(?1))
           AND u.job_event_id = (SELECT e.id FROM job_events e
             WHERE e.appointment_id = u.appointment_id AND e.kind = 'consumables' AND e.superseded = 0
             ORDER BY e.received_at DESC, e.rowid DESC LIMIT 1)
         ORDER BY u.rowid`,
      )
      .bind(ids),
    db
      .prepare(
        `SELECT e.appointment_id, p.piece_code FROM job_events e
         JOIN pieces p ON p.appointment_id = e.appointment_id AND p.piece_code = json_extract(e.body, '$.piece_code')
           AND p.deleted_at IS NULL
         WHERE e.appointment_id IN (SELECT value FROM json_each(?1)) AND e.kind = 'piece' AND e.superseded = 0
         ORDER BY e.received_at DESC, e.rowid DESC`,
      )
      .bind(ids),
  ]);
  const of = <Row extends { appointment_id: string }>(rows: unknown[] | undefined, id: string): Row[] =>
    ((rows ?? []) as Row[]).filter((row) => row.appointment_id === id);
  return visits.map((visit) => ({
    id: visit.id,
    date: indiaDate(new Date(visit.window_start)),
    type: visit.type,
    technician: visit.technician === null ? null : firstNameOf(visit.technician),
    result: stateOf(
      of<{ appointment_id: string; kind: "start" | "outcome"; body: string; occurred_at: string }>(
        events?.results,
        visit.id,
      ),
    ).outcome,
    note: of<{ appointment_id: string; body: string }>(notes?.results, visit.id)[0]?.body ?? null,
    photos: of<{ appointment_id: string; id: string; angle: string }>(photos?.results, visit.id).map((photo) => ({
      angle: photo.angle,
      url: photoUrl(job.id, photo.id),
    })),
    consumables: of<{ appointment_id: string; name: string; quantity: number }>(used?.results, visit.id).map(
      ({ name, quantity }) => ({ name, quantity }),
    ),
    piece: of<{ appointment_id: string; piece_code: string }>(pieces?.results, visit.id)[0]?.piece_code ?? null,
  }));
}

/** An earlier visit's after photographs, as the job open on the phone shows them with its handoff note. */
export async function afterPhotosOf(db: D1Database, jobId: string, visitId: string): Promise<HistoryPhoto[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.angle FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = 'after' ORDER BY ${ANGLE_ORDER}`,
    )
    .bind(visitId)
    .all<{ id: string; angle: string }>();
  return results.map((photo) => ({ angle: photo.angle, url: photoUrl(jobId, photo.id) }));
}

/**
 * The photograph a technician compares an angle with as they take it (docs/decisions/0244-the-visit-engine.md): before
 * the visit, the client's last after photograph of that angle; after it, this visit's own before photograph. Null where
 * there is none yet.
 */
export async function comparePhoto(
  db: D1Database,
  job: { readonly id: string; readonly personId: string; readonly startsAt: string },
  phase: "before" | "after",
  angle: string,
): Promise<{ key: string; contentType: string } | null> {
  const row =
    phase === "before"
      ? await db
          .prepare(
            `SELECT p.r2_key, p.content_type FROM photos p
             JOIN photo_sets s ON s.id = p.photo_set_id AND s.phase = 'after'
             JOIN appointments a ON a.id = s.appointment_id
             WHERE a.person_id = ?1 AND a.id <> ?2 AND a.deleted_at IS NULL AND a.window_start < ?3 AND p.angle = ?4
             ORDER BY a.window_start DESC, p.created_at DESC LIMIT 1`,
          )
          .bind(job.personId, job.id, job.startsAt, angle)
          .first<{ r2_key: string; content_type: string }>()
      : await db
          .prepare(
            `SELECT p.r2_key, p.content_type FROM photos p
             JOIN photo_sets s ON s.id = p.photo_set_id AND s.phase = 'before'
             WHERE s.appointment_id = ?1 AND p.angle = ?2 ORDER BY p.created_at DESC LIMIT 1`,
          )
          .bind(job.id, angle)
          .first<{ r2_key: string; content_type: string }>();
  return row === null ? null : { key: row.r2_key, contentType: row.content_type };
}

/**
 * One of the history's photographs, for the job open on the phone: an after photograph of an earlier visit of the
 * same client. Null where it is not one.
 */
export async function historyPhoto(
  db: D1Database,
  job: { readonly id: string; readonly personId: string; readonly startsAt: string },
  photoId: string,
): Promise<{ key: string; contentType: string } | null> {
  const row = await db
    .prepare(
      `SELECT p.r2_key, p.content_type FROM photos p
       JOIN photo_sets s ON s.id = p.photo_set_id AND s.phase = 'after'
       JOIN appointments a ON a.id = s.appointment_id
       WHERE p.id = ?1 AND a.person_id = ?2 AND a.id <> ?3 AND a.deleted_at IS NULL AND a.window_start < ?4`,
    )
    .bind(photoId, job.personId, job.id, job.startsAt)
    .first<{ r2_key: string; content_type: string }>();
  return row === null ? null : { key: row.r2_key, contentType: row.content_type };
}
