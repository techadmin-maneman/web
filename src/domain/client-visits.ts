// A client's visits and photographs, read for the client
// app (docs/prompts/phase2-backend.md, "Read endpoints"). Only the signed-in
// client's own rows are ever read; a visit or photograph of anyone else is
// "not found".

import { STANDARD_TIER, type VisitType } from "../config/visit-types.ts";
import { indiaDate } from "../lib/india-time.ts";
import { FITTED } from "./fitted.ts";
import { signToken } from "../lib/signed-token.ts";
import type { OneVisitState } from "../policy/one-visit.ts";
import { namesMoreThanItsKind } from "../policy/services.ts";
import type { AppointmentStatus, VisitOutcome } from "./visit-status.ts";
import { tickedItemsOf } from "./job-event-bodies.ts";
import { jobSheet } from "./job-sheet-settings.ts";
import { noShowNotes, type NoShowNote } from "./no-shows.ts";
import { oneVisitPrice, type OneVisitPrice } from "./one-visit-money.ts";
import { priceOf } from "./price-book.ts";
import { currentAddress } from "./profile.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { landedOutcome, visitBegun } from "./visit-begun.ts";
import { ANGLES, type Angle, type Phase } from "./visit-photos.ts";
import { MINUTE_MS, minutesBetween } from "../lib/durations.ts";
import { PAYMENT_HELD, statusIn } from "../config/statuses.ts";
import { creditSpentOn } from "./visit-facts.ts";

/** The three windows the client app offers (docs/prompts/phase2-frontend.md), by the hour a visit starts in India. */
type VisitWindowLabel = "morning" | "afternoon" | "evening";

/** A photograph's link lasts this long; the app asks again for a fresh one. */
export const PHOTO_LINK_MS = 15 * MINUTE_MS;

/**
 * Where a visit not yet closed stands for the client: still to come, under
 * way, closed as done from the technician's phone, or otherwise over and waiting
 * to be closed. A visit stays the client's until it is closed, so it
 * never drops out of both lists.
 */
type VisitStage = "booked" | "in_progress" | "done" | "closing";

interface VisitSummary {
  readonly id: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly window_label: VisitWindowLabel;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly length_minutes: number;
  readonly type: VisitType | null;
  /** Its service's name in the console, where it names more than the kind: a first fit's hair system, say. */
  readonly service: string | null;
  readonly status: AppointmentStatus;
  /** Null for a closed visit. */
  readonly stage: VisitStage | null;
  /** Paid for ahead, or covered by a credit: board C1's "Prepaid". */
  readonly prepaid: boolean;
  readonly technician: { readonly name: string; readonly initials: string } | null;
  readonly place: string;
  /** A consultation and fit in one visit not yet closed: what it costs once fitted. Null for any other visit. */
  readonly one_visit: OneVisitPrice | null;
  /** The client's note to the technician on this visit, as they last wrote it; null for none. */
  readonly client_note: string | null;
}

interface AppointmentRow {
  id: string;
  type: VisitType | null;
  /** Its service's tier; null where it names none, which is the standard tier's. */
  tier: string | null;
  one_visit: OneVisitState | null;
  /** The name of the service its tier is; null for none. */
  service_name: string | null;
  status: AppointmentStatus;
  window_start: string;
  window_end: string;
  service_city: string | null;
  service_pincode: string | null;
  technician_name: string | null;
  technician_initials: string | null;
  prepaid: number;
  begun: number;
  landed_outcome: VisitOutcome | null;
  client_note: string | null;
}

/**
 * Prepaid: a payment for the visit itself that Razorpay captured and has not
 * wholly sent back, or a booking a credit covered. Read here, never written.
 */
const PREPAID = `(EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.kind = 'visit'
    AND ${statusIn("p.status", PAYMENT_HELD)})
  OR ${creditSpentOn("a.id")})`;

const APPOINTMENT_COLUMNS = `a.id, a.type, a.tier, a.one_visit, a.status, a.window_start, a.window_end, a.service_city,
  a.service_pincode, (SELECT s.name FROM services s WHERE s.kind = a.type AND s.tier = a.tier) AS service_name,
  t.name AS technician_name, t.initials AS technician_initials, ${PREPAID} AS prepaid,
  ${visitBegun("a")} AS begun, ${landedOutcome("a")} AS landed_outcome, a.client_note`;
const LIVE = `a.person_id = ?1 AND a.deleted_at IS NULL AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL`;
/** The statuses of a visit not yet closed. */
const NOT_CLOSED: readonly AppointmentStatus[] = ["scheduled", "dispatched", "in_progress"];
export const UPCOMING_STATUSES = `('scheduled', 'dispatched', 'in_progress')`;
const PAST_STATUSES = `('completed', 'terminated')`;
/** A visit cancelled outright, not one a charged move replaced with a new visit, which stands in its place. */
const CANCELLED = `(a.status = 'cancelled' AND NOT EXISTS (SELECT 1 FROM visit_changes c
    WHERE c.appointment_id = a.id AND c.kind = 'replaced'))`;

/** What a visit's summary reads beyond its row: where it is, and the day's times its window is read by. */
interface SummaryContext {
  /** The client's saved address, else the visit's city and pincode. */
  readonly place: (row: AppointmentRow) => string;
  readonly schedule: SlotSchedule;
}

async function contextOf(db: D1Database, personId: string): Promise<SummaryContext> {
  const [address, schedule] = await Promise.all([currentAddress(db, personId), loadSlotSchedule(db)]);
  const place = (row: AppointmentRow) =>
    address !== null
      ? `${address.locality}, ${address.city} ${address.pincode}`
      : [row.service_city, row.service_pincode].filter((part) => part !== null).join(" ");
  return { place, schedule };
}

/**
 * The technician's steps come before the visit's status, which follows them: a visit he closed as done is done; one he closed otherwise, or whose window has ended, is being closed; one he has begun is in progress.
 */
function stageOf(row: AppointmentRow, now: Date): VisitStage | null {
  if (!NOT_CLOSED.includes(row.status)) return null;
  if (row.landed_outcome === "done") return "done";
  if (row.landed_outcome !== null) return "closing";
  if (Date.parse(row.window_end) < now.getTime()) return "closing";
  if (row.begun === 1 || row.status === "in_progress") return "in_progress";
  return "booked";
}

/** What a one visit not yet closed costs once fitted; null for any other visit. */
async function oneVisitOf(db: D1Database, row: AppointmentRow): Promise<OneVisitPrice | null> {
  if (row.one_visit !== "booked" || !NOT_CLOSED.includes(row.status)) return null;
  return oneVisitPrice(db, row.id, indiaDate(new Date(row.window_start)));
}

async function visitSummaryOf(
  db: D1Database,
  row: AppointmentRow,
  context: SummaryContext,
  now: Date,
): Promise<VisitSummary> {
  return {
    id: row.id,
    date: indiaDate(new Date(row.window_start)),
    window_label: context.schedule.at(row.window_start).window,
    starts_at: row.window_start,
    ends_at: row.window_end,
    length_minutes: minutesBetween(row.window_start, row.window_end),
    type: row.type,
    service: namesMoreThanItsKind(row.tier, row.one_visit) ? row.service_name : null,
    status: row.status,
    stage: stageOf(row, now),
    prepaid: row.prepaid === 1,
    technician:
      row.technician_name === null || row.technician_initials === null
        ? null
        : { name: row.technician_name, initials: row.technician_initials },
    place: context.place(row),
    one_visit: await oneVisitOf(db, row),
    client_note: row.client_note,
  };
}

/**
 * The client's next visit not yet closed, if any: the soonest still to come
 * or under way, and only if there is none of those, one that is over.
 */
export async function nextVisit(db: D1Database, personId: string, now: Date): Promise<VisitSummary | null> {
  const [row, context] = await Promise.all([
    db
      .prepare(
        `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE ${LIVE} AND a.status IN ${UPCOMING_STATUSES}
         ORDER BY a.window_end < ?2 OR landed_outcome IS NOT NULL, a.window_start LIMIT 1`,
      )
      .bind(personId, now.toISOString())
      .first<AppointmentRow>(),
    contextOf(db, personId),
  ]);
  return row === null ? null : visitSummaryOf(db, row, context, now);
}

/** The three states the apps show a client in. */
export const CLIENT_STATES = ["fitted", "lead", "nothing_booked"] as const;
type ClientState = (typeof CLIENT_STATES)[number];

/**
 * A client is fitted once a fit or a later visit is done, a lead while
 * something is booked for them, and otherwise has nothing booked. The client
 * app's Home card and the ops console's client page read the same rule.
 */
export function clientStateOf(fitted: boolean, hasBooking: boolean): ClientState {
  if (fitted) return "fitted";
  return hasBooking ? "lead" : "nothing_booked";
}

/** Whether the client has been fitted: a first fit, or any visit after one, has been done. */
export async function isFitted(db: D1Database, personId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT ${FITTED} AS fitted`).bind(personId).first<{ fitted: number }>();
  return row?.fitted === 1;
}

/** `withCancelled`: past visits include those cancelled, so the client's own list keeps a record of a cancellation. */
export async function listVisits(
  db: D1Database,
  personId: string,
  now: Date,
  { withCancelled = false }: { readonly withCancelled?: boolean } = {},
): Promise<{ upcoming: VisitSummary[]; past: VisitSummary[] }> {
  const pastStatus = withCancelled ? `(a.status IN ${PAST_STATUSES} OR ${CANCELLED})` : `a.status IN ${PAST_STATUSES}`;
  const [context, upcoming, past] = await Promise.all([
    contextOf(db, personId),
    db
      .prepare(
        `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE ${LIVE} AND a.status IN ${UPCOMING_STATUSES} ORDER BY a.window_start`,
      )
      .bind(personId)
      .all<AppointmentRow>(),
    db
      .prepare(
        `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id
         WHERE ${LIVE} AND ${pastStatus} ORDER BY a.window_start DESC`,
      )
      .bind(personId)
      .all<AppointmentRow>(),
  ]);
  return {
    upcoming: await Promise.all(upcoming.results.map((row) => visitSummaryOf(db, row, context, now))),
    past: await Promise.all(past.results.map((row) => visitSummaryOf(db, row, context, now))),
  };
}

interface PhotoLink {
  readonly angle: Angle;
  /** A link to the photograph that lasts 15 minutes, for the signed-in client only. */
  readonly url: string;
  /** A link to its small copy for the rows, likewise; null for a photograph with none, which the row shows itself. */
  readonly thumbnail_url: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

interface PhotoSet {
  readonly before: PhotoLink[];
  readonly after: PhotoLink[];
}

interface VisitDetail extends VisitSummary {
  /** From the visit's actual start to end; null until it is done. */
  readonly duration_minutes: number | null;
  readonly outcome: VisitOutcome | null;
  /** The checklist the technician ticked, in the job sheet's order; null when none was recorded. */
  readonly what_was_done: string[] | null;
  readonly photos: PhotoSet;
  /** The visit's invoice, for GET /api/documents/{id}, once Books has issued it. */
  readonly document_id: string | null;
  /**
   * Whether this visit is billed at all: false for a free one, and for one that
   * is not finished. Without it the app could only say "still generating" for
   * ever about a consultation that will never have an invoice (ADR 0056).
   */
  readonly invoice_expected: boolean;
  /**
   * Why a finished visit's invoice is held back rather than still to come
   * (ADR 0070): a credit paid for the visit, whose invoice waits on the CA's
   * ruling, or a draft being checked before it is sent. Null otherwise.
   */
  readonly invoice_held: InvoiceHeld | null;
  /** The client was not home: how long we waited, and what ops ruled. Null for any other visit. */
  readonly no_show: NoShowNote | null;
}

type InvoiceHeld = "credit" | "checking";

/**
 * A visit is billed when the price book charges for its service on the day it
 * happened. A free consultation totals nothing and has no invoice (ADR 0055). A
 * visit whose service is unpriced here counts as billed: its invoice is ops'.
 */
async function invoiceExpected(db: D1Database, row: AppointmentRow): Promise<boolean> {
  if (row.status !== "completed") return false;
  if (row.type === null) return true;
  const price = await priceOf(db, row.type, indiaDate(new Date(row.window_start)), row.tier ?? STANDARD_TIER);
  return price === null || price.amount_ex_gst > 0;
}

/**
 * Why a finished visit's invoice is held as a draft, as the invoice pass holds
 * it (src/domain/books-invoices.ts): never sent for a visit a credit paid for,
 * and one raised but not sent is being checked, its total not what the visit
 * was sold for or Books not sending it. Ops are told of either, and it waits on
 * their Tasks board as a draft invoice.
 */
async function invoiceHeld(
  db: D1Database,
  row: AppointmentRow & { invoice_issued_at: string | null; fsm_invoice_id: string | null },
): Promise<InvoiceHeld | null> {
  if (row.status !== "completed" || row.invoice_issued_at !== null) return null;
  const credit = await db
    .prepare(`SELECT ${creditSpentOn("?1")} AS paid_with_credit`)
    .bind(row.id)
    .first<{ paid_with_credit: number }>();
  if (credit?.paid_with_credit === 1) return "credit";
  return row.fsm_invoice_id === null ? null : "checking";
}

/**
 * What was done: the items of the job sheet's checklist that the technician
 * ticked, in the words ops gave them in the console, from the last checklist his
 * phone sent that was not superseded; an item ops have since taken off is still
 * named. The committed list (src/config/job-sheet.ts) stands until ops save one.
 * A visit closed with no checklist has none.
 */
async function whatWasDone(db: D1Database, visitId: string, type: VisitType | null): Promise<string[] | null> {
  if (type === null) return null;
  const event = await db
    .prepare(
      `SELECT body FROM job_events WHERE appointment_id = ?1 AND kind = 'checklist' AND superseded = 0
       ORDER BY received_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(visitId)
    .first<{ body: string }>();
  if (event === null) return null;
  const ticked = new Set(tickedItemsOf(JSON.parse(event.body)));
  const list = (await jobSheet(db)).checklists[type];
  return [...list.items, ...list.retired].filter((item) => ticked.has(item.id)).map((item) => item.label);
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
      `SELECT ${APPOINTMENT_COLUMNS}, a.invoice_issued_at, a.fsm_invoice_id, v.duration_minutes, v.outcome
       FROM appointments a LEFT JOIN technicians t ON t.id = a.technician_id LEFT JOIN visits v ON v.appointment_id = a.id
       WHERE ${LIVE} AND a.id = ?2`,
    )
    .bind(personId, visitId)
    .first<
      AppointmentRow & {
        invoice_issued_at: string | null;
        fsm_invoice_id: string | null;
        duration_minutes: number | null;
        outcome: VisitOutcome | null;
      }
    >();
  if (row === null) return null;
  const photos = await photoSets(db, [row.id], signingKey, now);
  const noShows = await noShowNotes(db, [row.id], now);
  return {
    ...(await visitSummaryOf(db, row, await contextOf(db, personId), now)),
    duration_minutes: row.duration_minutes,
    outcome: row.outcome,
    what_was_done: await whatWasDone(db, row.id, row.type),
    photos: photos.get(row.id) ?? { before: [], after: [] },
    document_id: row.invoice_issued_at === null ? null : row.id,
    invoice_expected: await invoiceExpected(db, row),
    invoice_held: await invoiceHeld(db, row),
    no_show: noShows.get(row.id) ?? null,
  };
}

/** What each of these visits was closed as, for the visits that are closed. */
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
  thumbnail_key: string | null;
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
      `SELECT p.id, s.appointment_id, s.phase, p.angle, p.width, p.height, p.thumbnail_key
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
      thumbnail_url:
        row.thumbnail_key === null
          ? null
          : `/api/photos/small/${await signToken(signingKey, "photo_small", row.id, expiresAt)}`,
      width: row.width,
      height: row.height,
    });
    sets.set(row.appointment_id, set);
  }
  return sets;
}

/** The R2 keys of one of the client's own photographs and its small copy; null for anyone else's. */
export async function ownPhotoKey(
  db: D1Database,
  personId: string,
  photoId: string,
): Promise<{ key: string; contentType: string; thumbnailKey: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT p.r2_key, p.content_type, p.thumbnail_key FROM photos p
       JOIN photo_sets s ON s.id = p.photo_set_id JOIN appointments a ON a.id = s.appointment_id
       WHERE p.id = ?1 AND a.person_id = ?2 AND a.deleted_at IS NULL`,
    )
    .bind(photoId, personId)
    .first<{ r2_key: string; content_type: string; thumbnail_key: string | null }>();
  if (row === null) return null;
  return { key: row.r2_key, contentType: row.content_type, thumbnailKey: row.thumbnail_key };
}
