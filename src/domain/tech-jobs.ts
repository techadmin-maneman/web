// The technician's day, read from the FSM mirror (src/policy/job-visibility.ts,
// docs/decisions/0032-fsm-mirror.md).
//
// "Today's jobs in order; tomorrow collapsed. Jobs further out show only time,
// type and sector. The address, access notes and client card unlock the day
// before, and the API enforces this, not just the screen." The enforcement is
// here: a locked job is built without the fields, not merely without them
// rendered, so no response carries an address the technician may not have yet.
//
// "No money anywhere in the technician app": a job carries a Prepaid, Credit or
// Free badge, and no amount leaves the database. Whether the price book charges
// nothing for the visit's own service on its day is asked in SQL, as a yes or a
// no (docs/decisions/0085-services-ops-can-edit.md).
//
// An unlocked card also carries what the technician needs at the door and no
// route gave him before: the client's pieces (board A3's piece card, and the
// piece step's "Pick from the list"), the last visit's after photograph, the
// no-show wait, and whether the day-before WhatsApp reached the client (board
// B5). The photograph itself is served on its own, and never cached.
//
// A consultation and fit in one visit also carries the products the client may
// choose at it, by name and never by price, and where the payment link closing
// it sent stands (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
// It and a consultation carry the client's hair profile as it stands and their
// consent to its history, for the profile step to start from; every unlocked
// card carries the profile, for the piece card
// (docs/decisions/0106-a-clients-hair-profile.md).

import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import { takesProfile } from "../policy/hair-profile.ts";
import type { CardStep, JobEventKind } from "../policy/in-job-steps.ts";
import { jobDay, paymentBadge, unlocked, unlocksAt, type JobDay, type PaymentBadge } from "../policy/job-visibility.ts";
import { slotsFor } from "../policy/dispatch.ts";
import { noShowWaitEnds, type Waits } from "../policy/no-show.ts";
import { paidAtTheVisit, type OneVisitState } from "../policy/one-visit.ts";
import { unitsFor } from "../policy/visit-length.ts";
import { latestArrival } from "./check-ins.ts";
import type { AppointmentStatus } from "./fsm-mirror.ts";
import { profileForCard, profileTakenAt, type HairProfile, type HealthConsent } from "./hair-profiles.ts";
import { EVIDENCE_MESSAGE } from "./no-shows.ts";
import { piecesOf, type Piece } from "./pieces.ts";
import { bookedMinutes } from "./scheduling.ts";
import { offeredServices } from "./services.ts";
import { windowAt } from "../policy/windows.ts";
import { firstNameOf } from "../lib/names.ts";

/** The statuses a job the technician still has work on can be in. */
const LIVE = ["scheduled", "dispatched", "in_progress"] as const;

export interface JobSummary {
  readonly id: string;
  readonly day: JobDay;
  readonly date: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly window_label: BookingWindow;
  readonly type: VisitType | null;
  /** A consultation and fit in one visit, which runs the first fit's steps with the client's choice at the piece. */
  readonly one_visit: boolean;
  /** Where the visit is, at the coarsest useful grain: a locked job shows this and nothing else of the place. */
  readonly sector: string | null;
  readonly status: AppointmentStatus;
  readonly badge: PaymentBadge;
  /** How much of the day the visit takes, as board A1 writes it beneath the time: 1, 1.5 or 2 slots. */
  readonly slots: number | null;
  readonly unlocked: boolean;
  readonly unlocks_at: string;
}

export interface JobClient {
  readonly name: string;
  readonly mobile: string;
  readonly note: string | null;
}

/** The address as the client saved it, the parts ADR 0054 added included: what gets him to the right door. */
export interface JobAddress {
  readonly line1: string;
  readonly line2: string | null;
  readonly building: string | null;
  readonly tower: string | null;
  readonly floor: string | null;
  readonly flat: string | null;
  readonly landmark: string | null;
  readonly locality: string;
  readonly city: string;
  readonly pincode: string;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface JobProgress {
  readonly checked_in_at: string | null;
  /**
   * When the job may close as a no-show, from the check-in the server holds, so
   * a phone that lost its own copy still knows (src/policy/no-show.ts).
   */
  readonly wait_ends_at: string | null;
  /** How far from the door that check-in was; null when nothing was measured. */
  readonly distance_m: number | null;
  readonly started_at: string | null;
  /** The steps sent so far, in the order they reached us: the job's events, and the profile once it is recorded. */
  readonly steps_done: CardStep[];
  readonly outcome: string | null;
}

/** One of the client's pieces, as board A3's piece card and the piece step's list show it. */
export interface CardPiece {
  readonly piece_code: string;
  readonly base: string | null;
  readonly supplier_lot: string | null;
  /** YYYY-MM-DD. */
  readonly fitted_at: string | null;
  /** YYYY-MM-DD. */
  readonly replacement_due_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
}

/** The client's visit before this one that has after photographs: board A3's "Last visit, after. 22 Aug, Imran." */
export interface LastVisit {
  /** YYYY-MM-DD, in India. */
  readonly date: string;
  /** The first name of the technician who did it. */
  readonly technician: string | null;
  readonly photo_url: string;
}

export interface JobDetail extends JobSummary {
  /** Null while the job is locked, whatever the mirror holds. */
  readonly address: JobAddress | null;
  readonly access_notes: string | null;
  readonly client: JobClient | null;
  readonly progress: JobProgress;
  /** How long this visit's type waits before a no-show may be closed, so a phone with no signal can count it. */
  readonly no_show_wait_min: number;
  /** The client's pieces, newest fit first; null while the job is locked. */
  readonly pieces: CardPiece[] | null;
  readonly last_visit: LastVisit | null;
  /** The day-before WhatsApp, or the arrival one, and when it reached the client's phone. */
  readonly reminder: { readonly delivered_at: string | null } | null;
  /**
   * On a one visit and a consultation, the products by name: the first fit's services offered that day, which the
   * one visit's client chooses from and the profile step names.
   */
  readonly products: Product[];
  /** On a one visit closed as done, the link the client pays by, and whether they have. */
  readonly payment_link: JobPaymentLink | null;
  /** The client's hair profile as it stands, and their consent to its history; null while the job is locked. */
  readonly profile: { readonly latest: HairProfile | null; readonly health_consent: HealthConsent } | null;
}

/** A product the client may choose at a one visit: a first fit's service, by its tier and its name. */
export interface Product {
  readonly tier: string;
  readonly name: string;
}

/** The payment link a one visit sent: its address, once Razorpay made it, and whether it is paid. */
export interface JobPaymentLink {
  readonly url: string | null;
  readonly paid: boolean;
}

interface JobRow {
  id: string;
  window_start: string;
  window_end: string | null;
  type: VisitType | null;
  one_visit: OneVisitState | null;
  status: AppointmentStatus;
  person_id: string | null;
  service_city: string | null;
  /** The area of the pincode the visit is booked for, where the service area names it. */
  pincode_area: string | null;
  /** The client's note from the app (src/domain/client-notes.ts). */
  client_note: string | null;
  client_name: string | null;
  client_mobile: string | null;
  line1: string | null;
  line2: string | null;
  building: string | null;
  tower: string | null;
  floor: string | null;
  flat: string | null;
  landmark: string | null;
  locality: string | null;
  city: string | null;
  pincode: string | null;
  access_notes: string | null;
  lat: number | null;
  lng: number | null;
  on_credit: number;
  free: number;
  /** The length of the visit's service, from the services table; null where no service is it. */
  service_minutes: number | null;
}

// `free`: the price book's row for the visit's own service, its kind and its tier (the standard tier's where the
// mirror knows no other), on the visit's day in India charges nothing, as it does a consultation.
const SELECT_JOB = `
  SELECT a.id, a.window_start, a.window_end, a.type, a.one_visit, a.status, a.person_id, a.service_city, a.client_note,
    sp.area AS pincode_area,
    p.name AS client_name, p.mobile_e164 AS client_mobile,
    d.line1, d.line2, d.building, d.tower, d.floor, d.flat, d.landmark, d.locality, d.city, d.pincode,
    d.access_notes, d.lat, d.lng,
    EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'redeem' AND l.source_id = a.id) AS on_credit,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = COALESCE(a.tier, 'standard')
                AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free,
    s.minutes AS service_minutes
  FROM appointments a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
  LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
  WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL`;

/** The jobs on one India date, in time order. Statuses the technician can still act on, and what he closed today. */
export async function jobsOn(
  db: D1Database,
  technicianId: string,
  date: string,
  now: Date,
  unlockHour: number,
): Promise<JobSummary[]> {
  const { results } = await db
    .prepare(`${SELECT_JOB} AND a.window_start >= ?2 AND a.window_start < ?3 ORDER BY a.window_start`)
    .bind(
      technicianId,
      indiaInstant(date, "00:00").toISOString(),
      indiaInstant(addDays(date, 1), "00:00").toISOString(),
    )
    .all<JobRow>();
  return results.filter(worthShowing).map((row) => summaryOf(row, now, unlockHour));
}

/** One job of this technician's, with everything the day-before unlock allows. */
export async function jobDetail(
  db: D1Database,
  options: { technicianId: string; jobId: string; now: Date; unlockHour: number; waits: Waits },
): Promise<JobDetail | null> {
  const row = await db.prepare(`${SELECT_JOB} AND a.id = ?2`).bind(options.technicianId, options.jobId).first<JobRow>();
  if (row === null) return null;
  const summary = summaryOf(row, options.now, options.unlockHour);
  const type = row.type ?? "service";
  const locked = {
    ...summary,
    address: null,
    access_notes: null,
    client: null,
    progress: await progressOf(db, { id: row.id, type }, options.waits),
    no_show_wait_min: options.waits[type],
    pieces: null,
    last_visit: null,
    reminder: null,
    products: takesProfile(type, row.one_visit !== null) ? await productsOn(db, summary.date) : [],
    payment_link: row.one_visit === null ? null : await paymentLinkOf(db, row.id),
    profile: null,
  };
  if (!summary.unlocked) return locked;
  return {
    ...locked,
    address: addressOf(row),
    access_notes: row.access_notes,
    client:
      row.client_name === null || row.client_mobile === null
        ? null
        : { name: row.client_name, mobile: row.client_mobile, note: row.client_note },
    pieces: row.person_id === null ? [] : (await piecesOf(db, row.person_id)).map(cardPiece),
    last_visit: await lastVisitOf(db, row),
    reminder: await reminderOf(db, row.id),
    profile: row.person_id === null ? null : await profileForCard(db, row.person_id),
  };
}

/** The products offered on a visit's day: the first fit's services offered and priced then, in ops' order. */
async function productsOn(db: D1Database, date: string): Promise<Product[]> {
  return (await offeredServices(db, date, ["first_fit"])).map((service) => ({
    tier: service.tier,
    name: service.name,
  }));
}

async function paymentLinkOf(db: D1Database, appointmentId: string): Promise<JobPaymentLink | null> {
  const link = await db
    .prepare("SELECT short_url, paid_at FROM payment_links WHERE appointment_id = ?1")
    .bind(appointmentId)
    .first<{ short_url: string | null; paid_at: string | null }>();
  return link === null ? null : { url: link.short_url, paid: link.paid_at !== null };
}

/** Dates as the piece lookup names them: the fitted and due dates are days, the failure an instant. */
function cardPiece(piece: Piece): CardPiece {
  return {
    piece_code: piece.piece_code,
    base: piece.base,
    supplier_lot: piece.supplier_lot,
    fitted_at: piece.fitted_at === null ? null : piece.fitted_at.slice(0, 10),
    replacement_due_at: piece.replacement_due_at === null ? null : piece.replacement_due_at.slice(0, 10),
    failed_at: piece.failed_at,
    failure_reason: piece.failure_reason,
  };
}

interface EarlierVisit {
  id: string;
  window_start: string;
  technician: string | null;
}

/** The client's latest visit before this one that has an after set, and who did it. */
async function lastVisit(db: D1Database, job: JobRow): Promise<EarlierVisit | null> {
  if (job.person_id === null) return null;
  return db
    .prepare(
      `SELECT a.id, a.window_start, t.name AS technician FROM appointments a
       JOIN photo_sets s ON s.appointment_id = a.id AND s.phase = 'after'
       LEFT JOIN technicians t ON t.id = a.technician_id
       WHERE a.person_id = ?1 AND a.id <> ?2 AND a.deleted_at IS NULL AND a.window_start < ?3
       ORDER BY a.window_start DESC LIMIT 1`,
    )
    .bind(job.person_id, job.id, job.window_start)
    .first<EarlierVisit>();
}

async function lastVisitOf(db: D1Database, row: JobRow): Promise<LastVisit | null> {
  const visit = await lastVisit(db, row);
  if (visit === null) return null;
  return {
    date: indiaDate(new Date(visit.window_start)),
    technician: visit.technician === null ? null : firstNameOf(visit.technician),
    photo_url: `/api/tech/jobs/${row.id}/last-visit-photo`,
  };
}

/** The front first, as board A3 draws it, then the other angles in the order they are taken. */
const ANGLE_ORDER =
  "CASE p.angle WHEN 'front' THEN 0 WHEN 'top' THEN 1 WHEN 'left' THEN 2 WHEN 'right' THEN 3 ELSE 4 END";

/**
 * The last visit's after photograph, for this technician's unlocked job only:
 * the rule the card it sits on keeps. Null when there is none to show.
 */
export async function lastVisitPhoto(
  db: D1Database,
  options: { technicianId: string; jobId: string; now: Date; unlockHour: number },
): Promise<{ key: string; contentType: string } | null> {
  const row = await db.prepare(`${SELECT_JOB} AND a.id = ?2`).bind(options.technicianId, options.jobId).first<JobRow>();
  if (row === null || !summaryOf(row, options.now, options.unlockHour).unlocked) return null;
  const visit = await lastVisit(db, row);
  if (visit === null) return null;
  const photo = await db
    .prepare(
      `SELECT p.r2_key, p.content_type FROM photos p JOIN photo_sets s ON s.id = p.photo_set_id
       WHERE s.appointment_id = ?1 AND s.phase = 'after' ORDER BY ${ANGLE_ORDER} LIMIT 1`,
    )
    .bind(visit.id)
    .first<{ r2_key: string; content_type: string }>();
  return photo === null ? null : { key: photo.r2_key, contentType: photo.content_type };
}

/** The WhatsApp ops read the receipt of on a no-show, as they read it (src/domain/no-shows.ts). */
async function reminderOf(db: D1Database, appointmentId: string): Promise<{ delivered_at: string | null } | null> {
  const message = await db.prepare(EVIDENCE_MESSAGE).bind(appointmentId).first<{ delivered_at: string | null }>();
  return message === null ? null : { delivered_at: message.delivered_at };
}

function addressOf(row: JobRow): JobAddress | null {
  if (row.line1 === null) return null;
  return {
    line1: row.line1,
    line2: row.line2,
    building: row.building,
    tower: row.tower,
    floor: row.floor,
    flat: row.flat,
    landmark: row.landmark,
    locality: row.locality ?? "",
    city: row.city ?? "",
    pincode: row.pincode ?? "",
    lat: row.lat,
    lng: row.lng,
  };
}

/** The job the technician may write to now: his own, live, and of a type we know. */
export interface WorkableJob {
  readonly id: string;
  readonly personId: string | null;
  readonly type: VisitType;
  /** Where a consultation and fit in one visit stands; null for any other visit. */
  readonly oneVisit: OneVisitState | null;
  readonly fsmId: string;
  readonly status: AppointmentStatus;
  readonly windowStart: Date;
  readonly technicianId: string;
}

export async function workableJob(db: D1Database, jobId: string): Promise<WorkableJob | null> {
  const row = await db
    .prepare(
      `SELECT id, person_id, type, one_visit, fsm_id, status, window_start, technician_id FROM appointments
       WHERE id = ?1 AND deleted_at IS NULL AND type IS NOT NULL AND window_start IS NOT NULL`,
    )
    .bind(jobId)
    .first<{
      id: string;
      person_id: string | null;
      type: VisitType;
      one_visit: OneVisitState | null;
      fsm_id: string;
      status: AppointmentStatus;
      window_start: string;
      technician_id: string | null;
    }>();
  const technicianId = row?.technician_id ?? null;
  if (row === null || technicianId === null) return null;
  return {
    id: row.id,
    personId: row.person_id,
    type: row.type,
    oneVisit: row.one_visit,
    fsmId: row.fsm_id,
    status: row.status,
    windowStart: new Date(row.window_start),
    technicianId,
  };
}

/** A job in the list: still live, or closed today so the technician can see what he did. */
function worthShowing(row: JobRow): boolean {
  return (LIVE as readonly string[]).includes(row.status) || row.status === "completed" || row.status === "terminated";
}

function summaryOf(row: JobRow, now: Date, unlockHour: number): JobSummary {
  const starts = new Date(row.window_start);
  const open = unlocked(starts, now, unlockHour);
  return {
    id: row.id,
    day: jobDay(starts, now),
    date: indiaDate(starts),
    starts_at: starts.toISOString(),
    ends_at: row.window_end,
    window_label: windowAt(indiaTime(starts)),
    type: row.type,
    one_visit: row.one_visit !== null,
    // "only time, type and sector": the area, never the street, whether the job is unlocked or not. The visit's
    // pincode names it first, as the dispatch board does (ADR 0069).
    sector: row.pincode_area ?? row.locality ?? row.service_city,
    status: row.status,
    badge: badgeOf(row),
    slots: row.type === null ? null : slotsFor(unitsFor(bookedMinutes(row))),
    unlocked: open,
    unlocks_at: unlocksAt(starts, unlockHour).toISOString(),
  };
}

function badgeOf(row: JobRow): PaymentBadge {
  return paymentBadge({ onCredit: row.on_credit === 1, free: row.free === 1, oneVisit: paidAtTheVisit(row.one_visit) });
}

/** What the phone has already sent for this job, from the events it landed. */
export async function progressOf(
  db: D1Database,
  job: { id: string; type: VisitType },
  waits: Waits,
): Promise<JobProgress> {
  const { results } = await db
    .prepare(
      `SELECT kind, body, occurred_at, received_at FROM job_events
       WHERE appointment_id = ?1 AND superseded = 0 ORDER BY received_at, rowid`,
    )
    .bind(job.id)
    .all<{ kind: JobEventKind; body: string; occurred_at: string; received_at: string }>();
  const checkIn = results.find((event) => event.kind === "check_in");
  const start = results.find((event) => event.kind === "start");
  const outcome = results.findLast((event) => event.kind === "outcome");
  const arrival = checkIn === undefined ? null : await latestArrival(db, job.id);
  return {
    checked_in_at: checkIn?.occurred_at ?? null,
    wait_ends_at: arrival === null ? null : noShowWaitEnds(arrival, job.type, waits).toISOString(),
    distance_m: arrival?.distanceM ?? null,
    started_at: start?.occurred_at ?? null,
    steps_done: await stepsDone(db, job.id, results),
    outcome: outcome === undefined ? null : outcomeOf(outcome.body),
  };
}

/** The steps that have reached us, in the order they did: the job's events after the start, and the profile. */
async function stepsDone(
  db: D1Database,
  jobId: string,
  events: readonly { kind: JobEventKind; received_at: string }[],
): Promise<CardStep[]> {
  const steps: { step: CardStep; at: string }[] = events
    .filter((event) => event.kind !== "check_in" && event.kind !== "start")
    .map((event) => ({ step: event.kind, at: event.received_at }));
  const profileAt = await profileTakenAt(db, jobId);
  if (profileAt !== null) steps.push({ step: "profile", at: profileAt });
  // A stable sort: steps that reached us in the same millisecond keep the order they were read in.
  return steps.sort((a, b) => a.at.localeCompare(b.at)).map((taken) => taken.step);
}

function outcomeOf(body: string): string | null {
  const parsed = JSON.parse(body) as { outcome?: unknown };
  return typeof parsed.outcome === "string" ? parsed.outcome : null;
}
