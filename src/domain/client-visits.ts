// A client's visits and photographs, read from the FSM mirror for the client
// app (docs/prompts/phase2-backend.md, "Read endpoints"). Only the signed-in
// client's own rows are ever read; a visit or photograph of anyone else is
// "not found".

import type { VisitType } from "../config/visit-types.ts";
import { indiaDate, indiaHour } from "../lib/india-time.ts";
import { signToken } from "../lib/signed-token.ts";
import type { AppointmentStatus } from "./fsm-mirror.ts";
import { currentAddress } from "./profile.ts";
import { ANGLES, type Angle, type Phase } from "./visit-photos.ts";

/** The three windows the client app offers (docs/prompts/phase2-frontend.md), by the hour a visit starts in India. */
export type VisitWindowLabel = "morning" | "afternoon" | "evening";

/** A photograph's link lasts this long; the app asks again for a fresh one. */
export const PHOTO_LINK_MS = 15 * 60 * 1000;

export function windowOf(startsAt: string): VisitWindowLabel {
  const hour = Number(indiaHour(new Date(startsAt)).slice(11, 13));
  return hour < 12 ? "morning" : hour < 16 ? "afternoon" : "evening";
}

export interface VisitSummary {
  readonly id: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly window_label: VisitWindowLabel;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly length_minutes: number;
  readonly type: VisitType | null;
  readonly status: AppointmentStatus;
  readonly technician: { readonly name: string; readonly initials: string } | null;
  readonly place: string;
}

interface AppointmentRow {
  id: string;
  type: VisitType | null;
  status: AppointmentStatus;
  window_start: string;
  window_end: string;
  service_city: string | null;
  service_pincode: string | null;
  technician_name: string | null;
  technician_initials: string | null;
}

const APPOINTMENT_COLUMNS = `a.id, a.type, a.status, a.window_start, a.window_end, a.service_city, a.service_pincode,
  t.name AS technician_name, t.initials AS technician_initials`;
const LIVE = `a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL`;
const UPCOMING_STATUSES = `('scheduled', 'dispatched', 'in_progress')`;
const PAST_STATUSES = `('completed', 'terminated')`;

/** Where a visit is: the client's saved address, else FSM's city and pincode. */
async function placeOf(db: D1Database, personId: string): Promise<(row: AppointmentRow) => string> {
  const address = await currentAddress(db, personId);
  return (row) =>
    address !== null
      ? `${address.locality}, ${address.city} ${address.pincode}`
      : [row.service_city, row.service_pincode].filter((part) => part !== null).join(" ");
}

function summaryOf(row: AppointmentRow, place: (row: AppointmentRow) => string): VisitSummary {
  return {
    id: row.id,
    date: indiaDate(new Date(row.window_start)),
    window_label: windowOf(row.window_start),
    starts_at: row.window_start,
    ends_at: row.window_end,
    length_minutes: Math.round((Date.parse(row.window_end) - Date.parse(row.window_start)) / 60_000),
    type: row.type,
    status: row.status,
    technician:
      row.technician_name === null || row.technician_initials === null
        ? null
        : { name: row.technician_name, initials: row.technician_initials },
    place: place(row),
  };
}

/** The client's next visit that has not happened yet, if any. */
export async function nextVisit(db: D1Database, personId: string, now: Date): Promise<VisitSummary | null> {
  const row = await db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE ${LIVE} AND a.status IN ${UPCOMING_STATUSES} AND a.window_end >= ?2
       ORDER BY a.window_start LIMIT 1`,
    )
    .bind(personId, now.toISOString())
    .first<AppointmentRow>();
  return row === null ? null : summaryOf(row, await placeOf(db, personId));
}

/** The three states the apps show a client in. */
export const CLIENT_STATES = ["fitted", "lead", "nothing_booked"] as const;
export type ClientState = (typeof CLIENT_STATES)[number];

/**
 * A client is fitted once a fit or a later visit is done, a lead while
 * something is booked for them, and otherwise has nothing booked. The client
 * app's Home card and the ops console's client page read the same rule.
 */
export function clientStateOf(fitted: boolean, hasBooking: boolean): ClientState {
  return fitted ? "fitted" : hasBooking ? "lead" : "nothing_booked";
}

/** Whether the client has been fitted: a first fit, or any visit after one, has been done. */
export async function isFitted(db: D1Database, personId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM appointments a WHERE ${LIVE} AND a.status = 'completed'
       AND a.type IN ('first_fit', 'service', 'replacement') LIMIT 1`,
    )
    .bind(personId)
    .first();
  return row !== null;
}

export async function listVisits(
  db: D1Database,
  personId: string,
  now: Date,
): Promise<{ upcoming: VisitSummary[]; past: VisitSummary[] }> {
  const place = await placeOf(db, personId);
  const upcoming = await db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE ${LIVE} AND a.status IN ${UPCOMING_STATUSES} AND a.window_end >= ?2 ORDER BY a.window_start`,
    )
    .bind(personId, now.toISOString())
    .all<AppointmentRow>();
  const past = await db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE ${LIVE} AND a.status IN ${PAST_STATUSES} ORDER BY a.window_start DESC`,
    )
    .bind(personId)
    .all<AppointmentRow>();
  return {
    upcoming: upcoming.results.map((row) => summaryOf(row, place)),
    past: past.results.map((row) => summaryOf(row, place)),
  };
}

export interface PhotoLink {
  readonly angle: Angle;
  /** A link to the photograph that lasts 15 minutes, for the signed-in client only. */
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface PhotoSet {
  readonly before: PhotoLink[];
  readonly after: PhotoLink[];
}

export interface VisitDetail extends VisitSummary {
  /** From FSM's actual start to end; null until the visit is done. */
  readonly duration_minutes: number | null;
  readonly outcome: "done" | "partial" | null;
  /** What the technician did; arrives with the job sheet (P2-M4). */
  readonly what_was_done: null;
  readonly photos: PhotoSet;
  /** The visit's invoice, for GET /api/documents/{id}, once Books has raised it. */
  readonly document_id: string | null;
}

/** One of the client's visits with its photographs; null for a visit that is not theirs. */
export async function visitDetail(
  db: D1Database,
  personId: string,
  visitId: string,
  signingKey: string,
  now: Date,
): Promise<VisitDetail | null> {
  const row = await db
    .prepare(
      `SELECT ${APPOINTMENT_COLUMNS}, a.fsm_invoice_id, v.duration_minutes, v.outcome
       FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id LEFT JOIN visits v ON v.appointment_id = a.id
       WHERE ${LIVE} AND a.id = ?2`,
    )
    .bind(personId, visitId)
    .first<
      AppointmentRow & {
        fsm_invoice_id: string | null;
        duration_minutes: number | null;
        outcome: "done" | "partial" | null;
      }
    >();
  if (row === null) return null;
  const photos = await photoSets(db, [row.id], signingKey, now);
  return {
    ...summaryOf(row, await placeOf(db, personId)),
    duration_minutes: row.duration_minutes,
    outcome: row.outcome,
    what_was_done: null,
    photos: photos.get(row.id) ?? { before: [], after: [] },
    document_id: row.fsm_invoice_id === null ? null : row.id,
  };
}

export type VisitOutcome = "done" | "partial";

/** What FSM closed each of these visits as, for the visits it has closed. */
export async function visitOutcomes(
  db: D1Database,
  appointmentIds: readonly string[],
): Promise<Map<string, VisitOutcome>> {
  if (appointmentIds.length === 0) return new Map();
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(`SELECT appointment_id, outcome FROM visits WHERE appointment_id IN (${placeholders})`)
    .bind(...appointmentIds)
    .all<{ appointment_id: string; outcome: VisitOutcome }>();
  return new Map(results.map((row) => [row.appointment_id, row.outcome]));
}

interface PhotoRow {
  id: string;
  appointment_id: string;
  phase: Phase;
  angle: Angle;
  width: number | null;
  height: number | null;
}

/** The photographs of these visits, each angle in the design's order, with fresh links. */
export async function photoSets(
  db: D1Database,
  appointmentIds: readonly string[],
  signingKey: string,
  now: Date,
): Promise<Map<string, PhotoSet>> {
  const sets = new Map<string, PhotoSet>();
  if (appointmentIds.length === 0) return sets;
  const placeholders = appointmentIds.map((_, index) => `?${String(index + 1)}`).join(", ");
  const { results } = await db
    .prepare(
      `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height
       FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id WHERE s.appointment_id IN (${placeholders})`,
    )
    .bind(...appointmentIds)
    .all<PhotoRow>();
  const expiresAt = new Date(now.getTime() + PHOTO_LINK_MS);
  for (const row of results.sort((a, b) => ANGLES.indexOf(a.angle) - ANGLES.indexOf(b.angle))) {
    const set = sets.get(row.appointment_id) ?? { before: [], after: [] };
    set[row.phase].push({
      angle: row.angle,
      url: `/api/photos/file/${await signToken(signingKey, "photo", row.id, expiresAt)}`,
      width: row.width,
      height: row.height,
    });
    sets.set(row.appointment_id, set);
  }
  return sets;
}

/** The R2 key of one of the client's own photographs; null for anyone else's. */
export async function ownPhotoKey(
  db: D1Database,
  personId: string,
  photoId: string,
): Promise<{ key: string; contentType: string } | null> {
  const row = await db
    .prepare(
      `SELECT p.r2_key, p.content_type FROM photos p
       JOIN photo_sets s ON s.id = p.photo_set_id JOIN appointments a ON a.id = s.appointment_id
       WHERE p.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(photoId, personId)
    .first<{ r2_key: string; content_type: string }>();
  return row === null ? null : { key: row.r2_key, contentType: row.content_type };
}
