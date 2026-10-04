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
// choose at it, by name and never by price, what they chose once the piece step
// lands, and where the payment link closing it sent stands
// (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md).
// Every unlocked card carries the client's hair profile as it stands, for the
// piece card and for the profile step to start from
// (docs/decisions/0106-a-clients-hair-profile.md).

import type { BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant } from "../lib/india-time.ts";
import { takesProfile } from "../policy/hair-profile.ts";
import { cardStepsFor, type CardStep, type JobEventKind } from "../policy/in-job-steps.ts";
import { jobDay, paymentBadge, unlocked, unlocksAt, type JobDay, type PaymentBadge } from "../policy/job-visibility.ts";
import { slotsFor } from "../policy/dispatch.ts";
import { noShowWaitEnds, type Waits } from "../policy/no-show.ts";
import { paidAtTheVisit, type Decision, type OneVisitState } from "../policy/one-visit.ts";
import { earliestCheckIn, type PhoneClock } from "../policy/phone-clock.ts";
import { namesMoreThanItsKind } from "../policy/services.ts";
import { unitsFor } from "../policy/visit-length.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { latestArrival } from "./check-ins.ts";
import { codeOnVisit, type VisitCode } from "./discount-code-uses.ts";
import type { AppointmentStatus } from "./visit-status.ts";
import { latestProfile, profileTakenAt, type HairProfile } from "./hair-profiles.ts";
import { EVIDENCE_MESSAGE } from "./no-shows.ts";
import { decisionAtVisit } from "./one-visit.ts";
import { piecesOf, type Piece } from "./pieces.ts";
import { bookedMinutes } from "./scheduling.ts";
import { offeredProducts } from "./services.ts";
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
  /** The service the visit was sold as, where it names more than the kind: a first fit's hair system, say. */
  readonly service: JobService | null;
  /** Where the visit is, at the coarsest useful grain: a locked job shows this and nothing else of the place. */
  readonly sector: string | null;
  readonly status: AppointmentStatus;
  readonly badge: PaymentBadge;
  /** How much of the day the visit takes, as board A1 writes it beneath the time: 1, 1.5 or 2 slots. */
  readonly slots: number | null;
  readonly unlocked: boolean;
  readonly unlocks_at: string;
  /** The client's name once the job unlocks, as the card gives it, so the day's list can say whom each job is for. */
  readonly client_name: string | null;
  /** When the job began and how it closed, from the events that landed, so the list says what the card says. */
  readonly progress: JobState;
}

export interface JobState {
  readonly started_at: string | null;
  readonly outcome: string | null;
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

export interface JobProgress extends JobState {
  readonly checked_in_at: string | null;
  /**
   * When the job may close as a no-show, from the check-in the server holds, so
   * a phone that lost its own copy still knows (src/policy/no-show.ts).
   */
  readonly wait_ends_at: string | null;
  /** How far from the door that check-in was; null when nothing was measured. */
  readonly distance_m: number | null;
  /** The steps sent so far, in the order they reached us: the job's events, and the profile once it is recorded. */
  readonly steps_done: CardStep[];
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
  /** The earliest moment the job takes a check-in or a start. */
  readonly checkin_from: string;
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
  /** On a one visit, the discount code already on it; never what it takes off. */
  readonly discount_code: JobCode | null;
  /** On a one visit, what the client decided as the piece step recorded it; null before that step landed. */
  readonly client_choice: Decision | null;
  /** The client's hair profile as it stands; null while the job is locked, or before one is recorded. */
  readonly profile: HairProfile | null;
  /** The screens this job runs, in order: its type's steps, and the profile where it takes one and has a client. */
  readonly steps: CardStep[];
}

/** A one visit's discount code, and who gave it: the client as they booked, ops, or the technician. */
export interface JobCode {
  readonly code: string;
  readonly given_by: VisitCode["givenBy"];
}

/** A service by its code, which the hair profile names a product by, and its name in the console. */
interface JobService {
  readonly tier: string;
  readonly name: string;
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
  /** The visit's service within its kind; null where the mirror knows none. */
  tier: string | null;
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
  /** The visit's service's name in the console; null where no service is it. */
  service_name: string | null;
}

// `free`: the price book's row for the visit's own service, its kind and its tier (the standard tier's where the
// mirror knows no other), on the visit's day in India charges nothing, as it does a consultation.
const SELECT_JOB = `
  SELECT a.id, a.window_start, a.window_end, a.type, a.tier, a.one_visit, a.status, a.person_id, a.service_city,
    a.client_note,
    sp.area AS pincode_area,
    p.name AS client_name, p.mobile_e164 AS client_mobile,
    d.line1, d.line2, d.building, d.tower, d.floor, d.flat, d.landmark, d.locality, d.city, d.pincode,
    d.access_notes, d.lat, d.lng,
    EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'redeem' AND l.source_id = a.id) AS on_credit,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = COALESCE(a.tier, 'standard')
                AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free,
    s.minutes AS service_minutes, s.name AS service_name
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
  const from = indiaInstant(date, "00:00").toISOString();
  const to = indiaInstant(addDays(date, 1), "00:00").toISOString();
  const [jobs, schedule, landed] = await Promise.all([
    db
      .prepare(`${SELECT_JOB} AND a.window_start >= ?2 AND a.window_start < ?3 ORDER BY a.window_start`)
      .bind(technicianId, from, to)
      .all<JobRow>(),
    loadSlotSchedule(db),
    startsAndOutcomesOn(db, technicianId, from, to),
  ]);
  return jobs.results
    .filter(worthShowing)
    .map((row) => summaryOf(row, now, unlockHour, schedule, stateOf(landed.get(row.id) ?? [])));
}

/** A job event as the job's state is read from it. */
interface LandedEvent {
  appointment_id: string;
  kind: JobEventKind;
  body: string;
  occurred_at: string;
}

/** Each of the technician's jobs between two instants: the starts and outcomes that landed, in the order they did. */
async function startsAndOutcomesOn(
  db: D1Database,
  technicianId: string,
  from: string,
  to: string,
): Promise<Map<string, LandedEvent[]>> {
  const { results } = await db
    .prepare(
      `SELECT e.appointment_id, e.kind, e.body, e.occurred_at FROM job_events e
       JOIN appointments a ON a.id = e.appointment_id
       WHERE a.technician_id = ?1 AND a.deleted_at IS NULL AND a.window_start >= ?2 AND a.window_start < ?3
         AND e.superseded = 0 AND e.kind IN ('start', 'outcome')
       ORDER BY e.received_at, e.rowid`,
    )
    .bind(technicianId, from, to)
    .all<LandedEvent>();
  const byJob = new Map<string, LandedEvent[]>();
  for (const event of results) {
    const events = byJob.get(event.appointment_id) ?? [];
    events.push(event);
    byJob.set(event.appointment_id, events);
  }
  return byJob;
}

/** When the job began and how it closed: its first start that landed, and its last outcome. */
function stateOf(events: readonly Pick<LandedEvent, "kind" | "body" | "occurred_at">[]): JobState {
  const start = events.find((event) => event.kind === "start");
  const outcome = events.findLast((event) => event.kind === "outcome");
  return {
    started_at: start?.occurred_at ?? null,
    outcome: outcome === undefined ? null : outcomeOf(outcome.body),
  };
}

/**
 * One job of this technician's, with everything the day-before unlock allows. Each read is a trip to D1 and back, so
 * the reads that need nothing from each other go together: the job and the day's times, then all the job leads to.
 */
export async function jobDetail(
  db: D1Database,
  options: { technicianId: string; jobId: string; now: Date; unlockHour: number; waits: Waits; phoneClock: PhoneClock },
): Promise<JobDetail | null> {
  const [row, schedule] = await Promise.all([
    db.prepare(`${SELECT_JOB} AND a.id = ?2`).bind(options.technicianId, options.jobId).first<JobRow>(),
    loadSlotSchedule(db),
  ]);
  if (row === null) return null;
  const type = row.type ?? "service";
  const oneVisit = row.one_visit !== null;
  const windowStart = new Date(row.window_start);
  const job = { id: row.id, type, windowStart, technicianId: options.technicianId };
  const [progress, products, paymentLink, discountCode, clientChoice, unlockedParts] = await Promise.all([
    progressOf(db, job, options.waits),
    takesProfile(type, oneVisit) ? productsOn(db, indiaDate(windowStart)) : [],
    oneVisit ? paymentLinkOf(db, row.id) : null,
    oneVisit ? jobCodeOf(db, row.id) : null,
    oneVisit ? decisionAtVisit(db, row.id) : null,
    unlocked(windowStart, options.now, options.unlockHour) ? unlockedPartsOf(db, row) : null,
  ]);
  const summary = summaryOf(row, options.now, options.unlockHour, schedule, progress);
  const locked = {
    ...summary,
    address: null,
    access_notes: null,
    client: null,
    progress,
    no_show_wait_min: options.waits[type],
    checkin_from: earliestCheckIn(windowStart, options.phoneClock).toISOString(),
    pieces: null,
    last_visit: null,
    reminder: null,
    products,
    payment_link: paymentLink,
    discount_code: discountCode,
    client_choice: clientChoice,
    profile: null,
    steps: cardStepsFor(type, oneVisit, row.person_id !== null),
  };
  if (unlockedParts === null) return locked;
  return {
    ...locked,
    address: addressOf(row),
    access_notes: row.access_notes,
    client:
      row.client_name === null || row.client_mobile === null
        ? null
        : { name: row.client_name, mobile: row.client_mobile, note: row.client_note },
    ...unlockedParts,
  };
}

/** What only an unlocked card carries beyond the job's own row: the client's pieces and profile, and their last visit. */
async function unlockedPartsOf(
  db: D1Database,
  row: JobRow,
): Promise<Pick<JobDetail, "pieces" | "last_visit" | "reminder" | "profile">> {
  const personId = row.person_id;
  const [pieces, lastVisit, reminder, profile] = await Promise.all([
    personId === null ? [] : piecesOf(db, personId),
    lastVisitOf(db, row),
    reminderOf(db, row.id),
    personId === null ? null : latestProfile(db, personId),
  ]);
  return { pieces: pieces.map(cardPiece), last_visit: lastVisit, reminder, profile };
}

/** The products offered on a visit's day: the hair systems offered and priced then, in ops' order. */
async function productsOn(db: D1Database, date: string): Promise<Product[]> {
  return (await offeredProducts(db, date)).map((service) => ({
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

async function jobCodeOf(db: D1Database, appointmentId: string): Promise<JobCode | null> {
  const code = await codeOnVisit(db, appointmentId);
  return code === null ? null : { code: code.code, given_by: code.givenBy };
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
  if (row === null || !unlocked(new Date(row.window_start), options.now, options.unlockHour)) return null;
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

function summaryOf(row: JobRow, now: Date, unlockHour: number, schedule: SlotSchedule, progress: JobState): JobSummary {
  const starts = new Date(row.window_start);
  const open = unlocked(starts, now, unlockHour);
  return {
    id: row.id,
    day: jobDay(starts, now),
    date: indiaDate(starts),
    starts_at: starts.toISOString(),
    ends_at: row.window_end,
    window_label: schedule.at(starts).window,
    type: row.type,
    one_visit: row.one_visit !== null,
    service: soldServiceOf(row),
    // "only time, type and sector": the area, never the street, whether the job is unlocked or not. The visit's
    // pincode names it first, as the dispatch board does (ADR 0069).
    sector: row.pincode_area ?? row.locality ?? row.service_city,
    status: row.status,
    badge: badgeOf(row),
    slots: row.type === null ? null : slotsFor(unitsFor(bookedMinutes(row))),
    unlocked: open,
    unlocks_at: unlocksAt(starts, unlockHour).toISOString(),
    client_name: open ? row.client_name : null,
    progress: { started_at: progress.started_at, outcome: progress.outcome },
  };
}

function soldServiceOf(row: JobRow): JobService | null {
  if (row.tier === null || row.service_name === null) return null;
  if (!namesMoreThanItsKind(row.tier, row.one_visit)) return null;
  return { tier: row.tier, name: row.service_name };
}

function badgeOf(row: JobRow): PaymentBadge {
  return paymentBadge({ onCredit: row.on_credit === 1, free: row.free === 1, oneVisit: paidAtTheVisit(row.one_visit) });
}

/**
 * What the phone has already sent for this job, from the events it landed. The check-in is the job's technician's
 * own, so one given the job after another checked in at it still has to arrive himself.
 */
export async function progressOf(
  db: D1Database,
  job: { id: string; type: VisitType; windowStart: Date; technicianId: string },
  waits: Waits,
): Promise<JobProgress> {
  const [events, arrival, profileAt] = await Promise.all([
    db
      .prepare(
        `SELECT kind, body, occurred_at, received_at FROM job_events
         WHERE appointment_id = ?1 AND superseded = 0 ORDER BY received_at, rowid`,
      )
      .bind(job.id)
      .all<{ kind: JobEventKind; body: string; occurred_at: string; received_at: string }>(),
    latestArrival(db, job),
    profileTakenAt(db, job.id),
  ]);
  const { results } = events;
  const { started_at, outcome } = stateOf(results);
  return {
    checked_in_at: arrival?.at.toISOString() ?? null,
    wait_ends_at: arrival === null ? null : noShowWaitEnds(arrival, job.windowStart, job.type, waits).toISOString(),
    distance_m: arrival?.distanceM ?? null,
    started_at,
    steps_done: stepsDone(results, profileAt),
    outcome,
  };
}

/** The steps that have reached us, in the order they did: the job's events after the start, and the profile. */
function stepsDone(
  events: readonly { kind: JobEventKind; received_at: string }[],
  profileAt: string | null,
): CardStep[] {
  const steps: { step: CardStep; at: string }[] = events
    .filter((event) => event.kind !== "check_in" && event.kind !== "start")
    .map((event) => ({ step: event.kind, at: event.received_at }));
  if (profileAt !== null) steps.push({ step: "profile", at: profileAt });
  // A stable sort: steps that reached us in the same millisecond keep the order they were read in.
  return steps.sort((a, b) => a.at.localeCompare(b.at)).map((taken) => taken.step);
}

function outcomeOf(body: string): string | null {
  const parsed = JSON.parse(body) as { outcome?: unknown };
  return typeof parsed.outcome === "string" ? parsed.outcome : null;
}
