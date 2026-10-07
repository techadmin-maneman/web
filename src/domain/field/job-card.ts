// One job's card for the technician (./tech-jobs.ts): locked, the time, type and sector only; unlocked the day
// before, the client, the address, the pieces, the last visit, the hair profile and what a one visit offers.

import { takesProfile } from "../../policy/hair-profile.ts";
import { firstNameOf } from "../../lib/names.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { cardStepsFor, type CardStep, type JobEventKind } from "../../policy/in-job-steps.ts";
import { noShowWaitEnds, type Waits } from "../../policy/no-show.ts";
import { unlocked } from "../../policy/job-visibility.ts";
import type { Decision } from "../../policy/one-visit.ts";
import { loadSlotSchedule } from "../booking/slot-times.ts";
import { offeredProducts } from "../booking/services.ts";
import { type PhoneClock, earliestCheckIn } from "../../policy/phone-clock.ts";
import { latestProfile, profileTakenAt, type HairProfile } from "../clients/hair-profiles.ts";
import { codeOnVisit, type VisitCode } from "../money/discount-code-uses.ts";
import { decisionAtVisit } from "../visits/one-visit.ts";
import { evidenceMessage, messageStateOf } from "../no-shows/no-shows.ts";
import { piecesOf, type Piece } from "./pieces.ts";
import { SELECT_JOB, listingOf, stateOf, type JobRow, type JobState, type JobSummary } from "./tech-jobs.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { latestArrival } from "../visits/check-ins.ts";

interface JobClient {
  readonly name: string;
  readonly mobile: string;
  readonly note: string | null;
}

/** The address as the client saved it, the parts ADR 0054 added included: what gets them to the right door. */
interface JobAddress {
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

/** One of the client's pieces, as the job card and the piece step's list show it. */
interface CardPiece {
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

/** The client's visit before this one that has after photographs: the job card's "Last visit, after. 22 Aug, Imran." */
interface LastVisit {
  /** YYYY-MM-DD, in India. */
  readonly date: string;
  /** The first name of the technician who did it. */
  readonly technician: string | null;
  readonly photo_url: string;
}

interface JobProgress extends JobState {
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

interface JobDetail extends JobSummary {
  /** Null while the job is locked. */
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
  /** The day-before WhatsApp, or the arrival one, that went to the client, and when it reached their phone. */
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
interface JobCode {
  readonly code: string;
  readonly given_by: VisitCode["givenBy"];
}

/** A product the client may choose at a one visit: a first fit's service, by its tier and its name. */
interface Product {
  readonly tier: string;
  readonly name: string;
}

/** The payment link a one visit sent: its address, once Razorpay made it, and whether it is paid. */
interface JobPaymentLink {
  readonly url: string | null;
  readonly paid: boolean;
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
  const summary = listingOf({ row, now: options.now, unlockHour: options.unlockHour, schedule, progress });
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

/** The front first, as the job card shows it, then the other angles in the order they are taken. */
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

/**
 * The WhatsApp ops read the receipt of on a no-show (src/domain/no-shows/no-shows.ts), where it went to the client; null where
 * none did, since one queued, skipped or failed never reached their phone.
 */
async function reminderOf(db: D1Database, appointmentId: string): Promise<{ delivered_at: string | null } | null> {
  const message = await evidenceMessage(db, appointmentId);
  if (message === null) return null;
  const state = messageStateOf(message);
  if (state !== "delivered" && state !== "sent") return null;
  return { delivered_at: message.delivered_at };
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

/**
 * What the phone has already sent for this job, from the events it landed. The check-in is the job's technician's
 * own, so one given the job after another checked in at it still has to arrive themselves.
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
