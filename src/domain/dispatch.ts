// The dispatch board, and the two writes ops make on it
// (src/policy/dispatch.ts, docs/decisions/0034-clash-check.md,
// docs/decisions/0069-dispatch-under-concurrency.md).
//
// "Rows are technicians; columns are seven days; each day has config
// SLOTS_PER_DAY (4) slots." The blocks come from the FSM mirror, the holds from
// slot_claims, and the clash check is the same one self-serve booking runs, so
// the two cannot disagree. A job is as long as its service, or as FSM books it
// where that is longer, and is sized, placed and moved by that length
// (docs/decisions/0085-services-ops-can-edit.md).
//
// "A technician cannot hold two live jobs in one window on one date. This check
// runs on the server before any write to FSM": the refusal below happens before
// anything is written anywhere. A technician on leave is refused the same way,
// and named as away rather than busy (ADR 0062); a free window with no room for
// the visit is named as that. Then the new time is claimed, then FSM, then the
// mirror, then the client's message. "The client's payment carries over and he
// is never charged for a move ops make", so no amount is read or written here
// at all: a visit carries a badge, never a figure.

import { BOOKING_WINDOWS, SLOTS_PER_DAY, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaIso, indiaTime } from "../lib/india-time.ts";
import {
  clientNotice,
  keepsTheClientsNotice,
  moveRefusal,
  slotsFor,
  type ClientNotice,
  type MoveReason,
  type MoveRefusal,
} from "../policy/dispatch.ts";
import { paymentBadge, type PaymentBadge } from "../policy/job-visibility.ts";
import { paidAtTheVisit, type OneVisitState } from "../policy/one-visit.ts";
import { FREE_CHANGE_NOTICE_HOURS } from "../policy/moving-a-visit.ts";
import { unitsFor } from "../policy/visit-length.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { listCities } from "./cities.ts";
import { syncAppointment, type AppointmentStatus } from "./fsm-mirror.ts";
import { leaveBetween } from "./leave.ts";
import {
  activeTechnicians,
  bookedMinutes,
  claimsOf,
  fitsAt,
  lettingGo,
  movesOpenSince,
  occupancy,
  placement,
  visitTimes,
  type Day,
} from "./scheduling.ts";
import { latestConsentSql } from "./messages.ts";
import { visitMessage } from "./visit-messages.ts";
import { unitAt, type SlotTimes } from "../policy/slot-times.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { failureReason } from "../log.ts";
import { MINUTE_MS } from "../lib/durations.ts";

/** Seven days, as the board shows them. */
export const BOARD_DAYS = 7;

/**
 * The client of a visit, as ops need him to reach him (board A3's WhatsApp and
 * Open client). None for a visit with no client on our records, or one erased.
 */
export interface BoardClient {
  readonly id: string;
  readonly name: string;
  readonly mobile: string;
  /** His latest word on WhatsApp about his visits is yes, so a move's new window reaches him there. */
  readonly whatsapp_visits: boolean;
  /** Who invited him, by name; null when he came on his own. */
  readonly referred_by: string | null;
}

/** What every job on the board carries, on a technician's day or in the tray. */
interface Visit {
  readonly appointment_id: string;
  readonly type: VisitType | null;
  /** "Rohit M.", as the board writes a client on a block. */
  readonly client: string | null;
  /** The area the visit's pincode is in, where the service area names it; else the address's locality or the city. */
  readonly sector: string | null;
  readonly pincode: string | null;
  readonly person: BoardClient | null;
  readonly badge: PaymentBadge;
  /** The visit's size on the board, from its length: 1, 1, 1.5 and 2 for the kinds' own. */
  readonly slots: number;
}

export interface Block extends Visit {
  readonly starts_at: string;
  readonly window: BookingWindow;
  readonly status: AppointmentStatus;
  /** The notice the visit was sold under, in hours: inside it, a change of the client's own costs them. */
  readonly notice_hours: number;
  /** The latest move of this visit that its client has not heard of: ops call him (src/policy/dispatch.ts). */
  readonly untold: { readonly move_id: string; readonly starts_at: string } | null;
}

export interface BoardDay {
  readonly date: string;
  readonly blocks: Block[];
}

export interface BoardRow {
  readonly technician_id: string;
  readonly name: string;
  readonly initials: string;
  readonly zone: string | null;
  readonly days: BoardDay[];
}

export interface UnassignedJob extends Visit {
  readonly starts_at: string;
  readonly asked_window: BookingWindow | null;
  readonly offered_window: BookingWindow | null;
  readonly date: string | null;
  /** The technician it is still on, who was switched off and has no row; null for a job nobody holds. */
  readonly was_technician: { readonly id: string; readonly name: string } | null;
}

export interface Board {
  readonly from: string;
  readonly dates: string[];
  /** The city the jobs are narrowed to; null for every city. */
  readonly city: string | null;
  /** The cities the board can be narrowed to. */
  readonly cities: string[];
  readonly technicians: BoardRow[];
  readonly unassigned: UnassignedJob[];
  /** Per day: the share of the working technicians' slots the day's jobs take. */
  readonly utilisation: { date: string; percent: number }[];
  /**
   * Leave ops recorded, clipped to the board's own week, so a column is drawn
   * away for exactly the days it is (ADR 0062). It does not come from FSM:
   * FSM's availability answers free time, never the reason for it.
   */
  readonly leave: { technician_id: string; from: string; to: string; note: string | null }[];
}

/**
 * The latest word on WhatsApp about his visits from the client of appointment `a`: 1, 0, or NULL where he never
 * gave one. The messaging consumer reads it the same way before it sends (src/domain/visit-messages.ts).
 */
const LATEST_VISITS_CONSENT = latestConsentSql("a.person_id", "whatsapp_visits");

/**
 * A move `m` of appointment `a` whose client has not heard of it: its day or window changed, no message was
 * queued or the one queued was never sent, ops have not said they called, and it still stands, since no later
 * move changed the time and the visit is still at the time it moved to. The Tasks board reads the same
 * (src/domain/tasks.ts).
 */
export const UNTOLD_MOVE = `m.fsm_write_state = 'written' AND m.was_start <> m.now_start AND m.told_at IS NULL
  AND m.now_start = a.window_start
  AND (m.message_id IS NULL OR EXISTS (
    SELECT 1 FROM outbound_messages o WHERE o.id = m.message_id AND o.state IN ('skipped', 'failed')))
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_moves later
    WHERE later.appointment_id = m.appointment_id AND later.fsm_write_state = 'written'
      AND later.was_start <> later.now_start AND later.created_at > m.created_at)`;

/** The statuses a job can still be moved in. */
const LIVE = "('scheduled', 'dispatched', 'in_progress')";
/** What a day on the board holds: its live jobs, and the ones already done, so a past day reads as it was worked. */
const ON_THE_BOARD = "('scheduled', 'dispatched', 'in_progress', 'completed')";

/**
 * Each job on the board, with its client, the area its pincode is in, its
 * length, and its badge: Credit where a service-visit credit paid for it, Free
 * where the price book charges nothing for its own service on its day, as the
 * technician's card reads them (src/domain/tech-jobs.ts). No amount leaves the
 * database. A job is the standard tier's where the mirror knows no other.
 */
const BOARD_JOBS = `
  SELECT a.id, a.type, a.one_visit, a.status, a.window_start, a.window_end, a.technician_id, a.service_city,
    a.service_pincode, a.asked_window, a.person_id, d.locality, sp.area, s.minutes AS service_minutes,
    p.name AS client_name, p.mobile_e164 AS client_mobile, p.erased_at AS client_erased_at,
    t.name AS technician_name, t.active AS technician_active,
    ${LATEST_VISITS_CONSENT} AS whatsapp_visits,
    (SELECT referrer.name FROM referral_attributions r
       JOIN referral_codes code ON code.code = r.code
       JOIN people referrer ON referrer.id = code.person_id
     WHERE r.referred_person_id = a.person_id AND referrer.erased_at IS NULL) AS referred_by,
    EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind = 'redeem' AND l.source_id = a.id) AS on_credit,
    (SELECT COALESCE(h.change_notice_hours, ?4) FROM slot_holds h
     WHERE h.appointment_id = a.id AND h.state = 'booked' ORDER BY h.updated_at DESC LIMIT 1) AS sold_notice_hours,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = COALESCE(a.tier, 'standard')
                AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free
  FROM appointments a
  LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN technicians t ON t.id = a.technician_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
  LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
  WHERE a.deleted_at IS NULL AND a.status IN ${ON_THE_BOARD} AND a.window_start >= ?1 AND a.window_start < ?2
    AND (?3 IS NULL OR a.service_city = ?3)
  ORDER BY a.window_start`;

/** The board's seven days from `from`. */
const weekFrom = (from: string): string[] => Array.from({ length: BOARD_DAYS }, (_, index) => addDays(from, index));

/**
 * The board for seven days from `from`, optionally narrowed to one city. `noticeHours` is the notice in force, which a
 * visit no hold sold is changed under (src/domain/visit-changes.ts).
 */
export async function dispatchBoard(
  db: D1Database,
  options: { from: string; city: string | null; noticeHours?: number },
): Promise<Board> {
  const dates = weekFrom(options.from);
  const last = dates[dates.length - 1] ?? options.from;
  const fromAt = indiaInstant(options.from, "00:00").toISOString();
  const toAt = indiaInstant(addDays(last, 1), "00:00").toISOString();

  const [technicians, scheduled, untold, cities, schedule] = await Promise.all([
    db
      .prepare("SELECT id, name, initials, zone FROM technicians WHERE active = 1 ORDER BY name")
      .all<{ id: string; name: string; initials: string; zone: string | null }>(),
    db.prepare(BOARD_JOBS).bind(fromAt, toAt, options.city, FREE_CHANGE_NOTICE_HOURS).all<BoardJobRow>(),
    db
      .prepare(
        `SELECT m.id, m.appointment_id, m.now_start FROM appointments a
         JOIN dispatch_moves m ON m.appointment_id = a.id
         WHERE a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.window_start >= ?1 AND a.window_start < ?2
           AND ${UNTOLD_MOVE}`,
      )
      .bind(fromAt, toAt)
      .all<{ id: string; appointment_id: string; now_start: string }>(),
    listCities(db),
    loadSlotSchedule(db),
  ]);
  const untoldOf = (appointmentId: string) => {
    const move = untold.results.find((each) => each.appointment_id === appointmentId);
    return move === undefined ? null : { move_id: move.id, starts_at: move.now_start };
  };

  const rows = technicians.results.map((technician): BoardRow => {
    const days = dates.map((date) => ({
      date,
      blocks: scheduled.results
        .filter((job) => job.technician_id === technician.id && indiaDate(new Date(job.window_start)) === date)
        .map((job) => blockOf(job, untoldOf(job.id), options.noticeHours ?? FREE_CHANGE_NOTICE_HOURS, schedule)),
    }));
    return {
      technician_id: technician.id,
      name: technician.name,
      initials: technician.initials,
      zone: technician.zone,
      days,
    };
  });

  const unassigned = scheduled.results
    .filter((job) => isNobodys(job) && job.status !== "completed")
    .map((job) => unassignedOf(job, schedule));
  const leave = (await leaveBetween(db, options.from, last)).map((period) => ({
    technician_id: period.technician_id,
    // Clipped to the week, so the board draws the days it has columns for and no others.
    from: period.from < options.from ? options.from : period.from,
    to: period.to > last ? last : period.to,
    note: period.note,
  }));
  return {
    from: options.from,
    dates,
    city: options.city,
    cities: cities.map((city) => city.name),
    technicians: rows,
    unassigned,
    utilisation: utilisationOf(rows, dates, leave),
    leave,
  };
}

interface BoardJobRow {
  id: string;
  type: VisitType | null;
  status: AppointmentStatus;
  window_start: string;
  window_end: string | null;
  service_minutes: number | null;
  technician_id: string | null;
  technician_name: string | null;
  technician_active: number | null;
  service_city: string | null;
  service_pincode: string | null;
  asked_window: BookingWindow | null;
  person_id: string | null;
  locality: string | null;
  area: string | null;
  client_name: string | null;
  client_mobile: string | null;
  client_erased_at: string | null;
  whatsapp_visits: number | null;
  referred_by: string | null;
  on_credit: number;
  free: number;
  /** Where a consultation and fit in one visit stands; null for any other visit. */
  one_visit: OneVisitState | null;
  /** Null where no hold sold the visit; the committed notice where one did and kept none. */
  sold_notice_hours: number | null;
}

function visitOf(job: BoardJobRow): Visit {
  return {
    appointment_id: job.id,
    type: job.type,
    client: shortName(job.client_name),
    sector: job.area ?? job.locality ?? job.service_city,
    pincode: job.service_pincode,
    person: clientOf(job),
    badge: paymentBadge({
      onCredit: job.on_credit === 1,
      free: job.free === 1,
      oneVisit: paidAtTheVisit(job.one_visit),
    }),
    slots: slotsFor(unitsFor(bookedMinutes(job))),
  };
}

/** The client, unless there is none on our records or he has been erased: nothing is left to reach him by. */
function clientOf(job: BoardJobRow): BoardClient | null {
  if (job.person_id === null || job.client_name === null || job.client_mobile === null) return null;
  if (job.client_erased_at !== null) return null;
  return {
    id: job.person_id,
    name: job.client_name,
    mobile: job.client_mobile,
    whatsapp_visits: job.whatsapp_visits === 1,
    referred_by: job.referred_by,
  };
}

function blockOf(job: BoardJobRow, untold: Block["untold"], noticeInForce: number, schedule: SlotSchedule): Block {
  const start = new Date(job.window_start);
  return {
    ...visitOf(job),
    starts_at: start.toISOString(),
    window: schedule.at(start).window,
    status: job.status,
    notice_hours: job.sold_notice_hours ?? noticeInForce,
    untold,
  };
}

/**
 * A job no technician on the board holds: none was given it, or the one it is on was switched off, as FSM's sync
 * or ops may do with visits still on him. Either way it waits in the tray.
 */
const isNobodys = (job: BoardJobRow): boolean => job.technician_id === null || job.technician_active !== 1;

/** The switched-off technician a tray job is still on, so the tray can say whose it was. */
function wasTechnicianOf(job: BoardJobRow): UnassignedJob["was_technician"] {
  if (job.technician_id === null || job.technician_name === null) return null;
  return { id: job.technician_id, name: job.technician_name };
}

function unassignedOf(job: BoardJobRow, schedule: SlotSchedule): UnassignedJob {
  const start = new Date(job.window_start);
  return {
    ...visitOf(job),
    starts_at: start.toISOString(),
    // What the client asked for, resolved from the Request behind the visit (ADR
    // 0060). Null where nothing recorded one, and the tray says so in words: the
    // offered window is never repeated as though it were the asked one.
    asked_window: job.asked_window,
    offered_window: schedule.at(start).window,
    date: indiaDate(start),
    was_technician: wasTechnicianOf(job),
  };
}

/** "Rohit M.", as the board writes a client. */
function shortName(name: string | null): string | null {
  if (name === null) return null;
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last === undefined ? (first ?? null) : `${first ?? ""} ${last.slice(0, 1)}.`;
}

/** Whether a technician is away on a date, by the leave the board holds; both ends are inclusive. */
const isAway = (leave: Board["leave"], technicianId: string, date: string): boolean =>
  leave.some((period) => period.technician_id === technicianId && period.from <= date && date <= period.to);

/**
 * "Each column head shows its utilisation, in per cent." The slots the day's
 * jobs take, done or still to do, out of the slots of the technicians working
 * that day. A technician on leave has no slots that day, and a job still on him
 * counts for nothing until it is moved. The board's rows are already narrowed to
 * its city's jobs; the technicians are not, since none carries a city and any
 * may be sent anywhere (docs/decisions/0069-dispatch-under-concurrency.md).
 */
export function utilisationOf(
  rows: readonly BoardRow[],
  dates: readonly string[],
  leave: Board["leave"],
): { date: string; percent: number }[] {
  return dates.map((date) => {
    const working = rows.filter((row) => !isAway(leave, row.technician_id, date));
    const capacity = working.length * SLOTS_PER_DAY;
    const taken = working
      .flatMap((row) => row.days.find((day) => day.date === date)?.blocks ?? [])
      .reduce((slots, block) => slots + block.slots, 0);
    return { date, percent: capacity === 0 ? 0 : Math.round((taken / capacity) * 100) };
  });
}

export interface MoveInput {
  readonly appointmentId: string;
  /** The technician it goes to; absent keeps the one it has. */
  readonly technicianId?: string | null;
  /** The India date and window it goes to; absent keeps the time it has. */
  readonly date?: string | null;
  readonly window?: BookingWindow | null;
  readonly reason: MoveReason;
  /** The Access identity that made the move (ADR 0031). */
  readonly actor: string;
  /** The job as the board the move was made from showed it: its technician, none in the tray, and its start. */
  readonly expected: { readonly technicianId: string | null; readonly startsAt: string };
}

/**
 * What changed under a board since it was loaded: the job's technician, its
 * time, or another move of it still being written.
 */
export type Change = "technician" | "time" | "moving";

export type MoveOutcome =
  | { readonly kind: "moved"; readonly moveId: string; readonly clientNotice: ClientNotice }
  | { readonly kind: "refused"; readonly reason: MoveRefusal }
  | { readonly kind: "not_found" }
  /** A job in the tray, sent with no technician to put it on. */
  | { readonly kind: "no_technician" }
  /** The board the move was made from no longer shows the job as it is; nothing was written. */
  | { readonly kind: "superseded"; readonly changed: readonly Change[] }
  /** The move names the technician, day and window the job already has. */
  | { readonly kind: "nothing_to_move" }
  /** FSM would not take it: nothing moved, and the refusal is on the record. */
  | { readonly kind: "fsm_refused"; readonly moveId: string }
  /** FSM took the new technician and not the new time; the mirror now holds what FSM does. */
  | { readonly kind: "fsm_partly"; readonly moveId: string };

/** Where a move puts a job, and whether it keeps the time it has. */
interface Target {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  /** Only the technician changes: the visit keeps its own start, and its half-slots are checked there. */
  readonly keepsTime: boolean;
  /** The target day's times, which its half-slots are read by. */
  readonly times: SlotTimes;
}

type Landing =
  { readonly kind: "lands"; readonly start: number } | { readonly kind: "refused"; readonly reason: MoveRefusal };

/** A job as a move places it: how long it is, and when it starts now. */
interface Placing {
  readonly minutes: number;
  readonly start: Date;
}

/** The half-slot a job would start in on the target's day, or null where it has no room. */
function startOn(day: Day, job: Placing, target: Target): number | null {
  const units = unitsFor(job.minutes);
  if (!target.keepsTime) return placement(day, target.window, units);
  const start = unitAt(indiaTime(job.start), target.times);
  return fitsAt(day, start, units) ? start : null;
}

/** Where the job lands on the target's day, or why it cannot. */
function landingOf(day: Day, job: Placing, target: Target): Landing {
  const start = startOn(day, job, target);
  const refusal = moveRefusal(day, target.window, { fits: start !== null });
  if (refusal !== null) return { kind: "refused", reason: refusal };
  return start === null ? { kind: "refused", reason: "does_not_fit" } : { kind: "lands", start };
}

export interface MoveDeps {
  readonly fsm: FsmProvider;
  readonly labelAsTest: boolean;
  /** Queues the client's "your visit is now …" message. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

interface LiveJob {
  id: string;
  fsm_id: string;
  person_id: string | null;
  type: VisitType;
  status: AppointmentStatus;
  window_start: string;
  window_end: string | null;
  start_before_move: string | null;
  technician_id: string | null;
  service_minutes: number | null;
}

/** A job that can still be moved; null for one done, cancelled, gone from FSM, or with no type or time. */
function liveJob(db: D1Database, appointmentId: string): Promise<LiveJob | null> {
  return db
    .prepare(
      `SELECT a.id, a.fsm_id, a.person_id, a.type, a.status, a.window_start, a.window_end, a.start_before_move,
         a.technician_id, s.minutes AS service_minutes
       FROM appointments a LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.type IS NOT NULL
         AND a.window_start IS NOT NULL`,
    )
    .bind(appointmentId)
    .first<LiveJob>();
}

/** Where a move puts the job. A day and window that are the job's own keep its start: only the technician changes. */
function targetOf(
  job: LiveJob,
  technicianId: string,
  date: string,
  window: BookingWindow,
  schedule: SlotSchedule,
): Target {
  const now = schedule.at(job.window_start);
  const keepsTime = date === now.date && window === now.window;
  return { technicianId, date, window, keepsTime, times: schedule.on(date) };
}

/** Where the job already is: no move at all. */
const isWhereItIs = (job: LiveJob, target: Target): boolean =>
  target.keepsTime && target.technicianId === job.technician_id;

/**
 * Assigns or moves one job: the checks, then the new time claimed, then FSM,
 * then the mirror and the client's message, with the claim let go in the same
 * batch. Assigning and moving are the same write; only what the caller changes
 * differs.
 */
export async function moveJob(db: D1Database, deps: MoveDeps, input: MoveInput, now: Date): Promise<MoveOutcome> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null) return { kind: "not_found" };
  const changed = changedSince(job, input.expected);
  if (changed.length > 0) return { kind: "superseded", changed };

  const wasStart = new Date(job.window_start);
  const technicianId = input.technicianId ?? job.technician_id;
  if (technicianId === null) return { kind: "no_technician" };
  const schedule = await loadSlotSchedule(db);
  // What ops left out keeps what the job has.
  const date = input.date ?? indiaDate(wasStart);
  const window = input.window ?? schedule.at(wasStart).window;
  const target = targetOf(job, technicianId, date, window, schedule);
  if (isWhereItIs(job, target)) return { kind: "nothing_to_move" };

  // The check runs on the server before any write to FSM. The job's own time
  // does not count against its own move.
  const held = await occupancy(db, date, date, now, job.id);
  const minutes = bookedMinutes(job);
  const landing = landingOf(held(technicianId, date), { minutes, start: wasStart }, target);
  if (landing.kind === "refused") return landing;

  const times = target.keepsTime ? null : visitTimes(date, landing.start, minutes, schedule);
  const nowStart = times?.start ?? wasStart;
  const moveId = crypto.randomUUID();
  const opened = await openMove(
    db,
    {
      id: moveId,
      job,
      technicianId,
      nowStart: nowStart.toISOString(),
      reason: input.reason,
      actor: input.actor,
    },
    { date, claims: claimsOf(landing.start, unitsFor(minutes), window) },
    now,
  );
  if (opened === "moving") return { kind: "superseded", changed: ["moving"] };
  if (opened === "taken") return { kind: "refused", reason: "clash" };

  // FSM takes a move in two writes, the technician and then the time, so one can land without the other.
  let assigned = false;
  try {
    if (technicianId !== job.technician_id) {
      await deps.fsm.assignVisit(job.fsm_id, await fsmResourceId(db, technicianId));
      assigned = true;
    }
    if (times !== null) {
      await deps.fsm.rescheduleVisit(job.fsm_id, { start: indiaIso(times.start), end: indiaIso(times.end) });
    }
  } catch (error) {
    const reason = failureReason(error);
    await db.batch([
      releasingClaims(db, moveId),
      db
        .prepare(
          "UPDATE dispatch_moves SET fsm_write_state = 'rejected', fsm_error = ?2, updated_at = ?3 WHERE id = ?1",
        )
        .bind(moveId, assigned ? `the technician was changed, the time was not: ${reason}` : reason, now.toISOString()),
    ]);
    if (!assigned) return { kind: "fsm_refused", moveId };
    // Half a move is not a refusal: the job is read again from FSM, so the board shows where it now is.
    await syncAppointment(db, deps.fsm, job.fsm_id, now).catch(() => null);
    return { kind: "fsm_partly", moveId };
  }

  // FSM took it: the mirror follows, and the client is told his new window, if he has one.
  const at = now.toISOString();
  const notice = clientNotice({
    timeChanged: !target.keepsTime,
    client: job.person_id === null ? null : { agreedToWhatsApp: await agreedToVisitMessages(db, job.id) },
  });
  const message =
    notice === "messaged" && job.person_id !== null
      ? visitMessage(db, { personId: job.person_id, appointmentId: job.id, kind: "visit_moved", now })
      : null;
  await db.batch([
    db
      .prepare(
        `UPDATE appointments SET technician_id = ?2, window_start = ?3, window_end = ?4, synced_at = ?5,
           start_before_move = ?6
         WHERE id = ?1`,
      )
      .bind(
        job.id,
        technicianId,
        nowStart.toISOString(),
        (times?.end ?? new Date(nowStart.getTime() + minutes * MINUTE_MS)).toISOString(),
        at,
        times === null ? job.start_before_move : startBeforeMoving(job, input.reason),
      ),
    // The mirror now holds the new time, so the claim on it goes in the same batch.
    releasingClaims(db, moveId),
    // The message row is written before the move points at it.
    ...(message === null ? [] : [message.statement]),
    db
      .prepare("UPDATE dispatch_moves SET fsm_write_state = 'written', message_id = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(moveId, message?.id ?? null, at),
  ]);
  if (message !== null) await deps.notify?.(message.id);
  return { kind: "moved", moveId, clientNotice: notice };
}

/**
 * The time the client's notice counts from once this move changes the job's time: the time they last chose, which
 * a move ops make keeps, and none once the client asked for this one (src/policy/dispatch.ts).
 */
function startBeforeMoving(job: LiveJob, reason: MoveReason): string | null {
  if (!keepsTheClientsNotice(reason)) return null;
  return job.start_before_move ?? job.window_start;
}

/** What differs between the job now and the board the move was made from. */
function changedSince(job: LiveJob, expected: MoveInput["expected"]): Change[] {
  const changed: Change[] = [];
  if (job.technician_id !== expected.technicianId) changed.push("technician");
  if (new Date(job.window_start).getTime() !== new Date(expected.startsAt).getTime()) changed.push("time");
  return changed;
}

/** Whether the latest word on WhatsApp about his visits from the client of this job is yes. */
async function agreedToVisitMessages(db: D1Database, appointmentId: string): Promise<boolean> {
  const latest = await db
    .prepare(`SELECT ${LATEST_VISITS_CONSENT} AS granted FROM appointments a WHERE a.id = ?1`)
    .bind(appointmentId)
    .first<{ granted: number | null }>();
  return latest?.granted === 1;
}

interface OpenMove {
  readonly id: string;
  readonly job: LiveJob;
  readonly technicianId: string;
  readonly nowStart: string;
  readonly reason: MoveReason;
  readonly actor: string;
}

/**
 * Opens the move and claims its new time on the technician's day, in one
 * batch, before FSM is written. The claims' key is the one holds use, so a
 * hold or another move cannot take the time until the move lets it go. What
 * stands in the way: another move of the same job still open ("moving"), or a
 * hold or move that took the time since it was checked ("taken"). A paid hold's
 * claims are never let go here; only a hold nobody is paying for, or a move
 * that never finished.
 */
async function openMove(
  db: D1Database,
  move: OpenMove,
  time: { readonly date: string; readonly claims: readonly string[] },
  now: Date,
): Promise<"open" | "moving" | "taken"> {
  const at = now.toISOString();
  try {
    await db.batch([
      ...unfinishedMovesLetGo(db, now),
      ...lettingGo(db, now),
      db
        .prepare(
          `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
             reason, actor, fsm_write_state, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9)`,
        )
        .bind(
          move.id,
          move.job.id,
          move.job.technician_id,
          move.technicianId,
          move.job.window_start,
          move.nowStart,
          move.reason,
          move.actor,
          at,
        ),
      ...time.claims.map((claim) =>
        db
          .prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)")
          .bind(move.technicianId, time.date, claim, move.id),
      ),
    ]);
    return "open";
  } catch (error) {
    if (failedUniqueOn(error, "dispatch_moves")) return "moving";
    if (failedUniqueOn(error, "slot_claims")) return "taken";
    throw error;
  }
}

/** Whether a write failed on one of this table's unique keys, as SQLite words it: "UNIQUE constraint failed: t.c". */
const failedUniqueOn = (error: unknown, table: string): boolean =>
  error instanceof Error && error.message.includes(`UNIQUE constraint failed: ${table}.`);

const releasingClaims = (db: D1Database, moveId: string): D1PreparedStatement =>
  db.prepare("DELETE FROM slot_claims WHERE move_id = ?1").bind(moveId);

/** Moves opened too long ago to finish now. */
const UNFINISHED = "SELECT id FROM dispatch_moves WHERE fsm_write_state = 'pending' AND created_at <= ?1";

/**
 * Lets go of the time claimed by moves that never finished, and closes them.
 * Whether FSM took such a move is FSM's to say: the mirror follows FSM's own
 * record of it, as it follows every change FSM makes.
 */
export function unfinishedMovesLetGo(db: D1Database, now: Date): D1PreparedStatement[] {
  const since = movesOpenSince(now);
  return [
    db.prepare(`DELETE FROM slot_claims WHERE move_id IN (${UNFINISHED})`).bind(since),
    db
      .prepare(
        `UPDATE dispatch_moves SET fsm_write_state = 'rejected', fsm_error = ?2, updated_at = ?3 WHERE id IN (${UNFINISHED})`,
      )
      .bind(since, "never finished: FSM may hold it, and its own record says", now.toISOString()),
  ];
}

export interface Room {
  readonly technician_id: string;
  readonly date: string;
  /** The windows the job would land in, by the check a move runs. */
  readonly windows: BookingWindow[];
}

/**
 * Where a job in hand can go in the week from `from`: each technician's day
 * with a window the job would land in, by the same check a move runs, so the
 * board offers no window the move would be refused. Not where it already is.
 * Null for a job no longer live.
 */
export async function roomFor(
  db: D1Database,
  input: { readonly appointmentId: string; readonly from: string },
  now: Date,
): Promise<Room[] | null> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null) return null;
  const dates = weekFrom(input.from);
  const [technicians, held, schedule] = await Promise.all([
    activeTechnicians(db),
    occupancy(db, input.from, dates[dates.length - 1] ?? input.from, now, job.id),
    loadSlotSchedule(db),
  ]);
  const visit = { minutes: bookedMinutes(job), start: new Date(job.window_start) };
  const windowsFor = (technicianId: string, date: string) =>
    BOOKING_WINDOWS.filter((window) => {
      const target = targetOf(job, technicianId, date, window, schedule);
      return !isWhereItIs(job, target) && landingOf(held(technicianId, date), visit, target).kind === "lands";
    });
  return technicians
    .flatMap((technician) =>
      dates.map((date) => ({ technician_id: technician.id, date, windows: windowsFor(technician.id, date) })),
    )
    .filter((room) => room.windows.length > 0);
}

/**
 * Ops called the client about a move he had not heard of, which closes its
 * task. Recorded once, and only for a move still untold: false for any other.
 * The audit entry goes in the same batch (src/domain/audit.ts).
 */
export async function recordToldByPhone(
  db: D1Database,
  input: { readonly moveId: string; readonly actor: string; readonly audit: AuditEntry; readonly now: Date },
): Promise<boolean> {
  const untold = await db
    .prepare(
      `SELECT 1 FROM dispatch_moves m JOIN appointments a ON a.id = m.appointment_id WHERE m.id = ?1 AND ${UNTOLD_MOVE}`,
    )
    .bind(input.moveId)
    .first();
  if (untold === null) return false;
  const at = input.now.toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE dispatch_moves SET told_at = ?2, told_by = ?3, updated_at = ?2 WHERE id = ?1 AND told_at IS NULL",
      )
      .bind(input.moveId, at, input.actor),
    auditStatement(db, input.audit, input.now),
  ]);
  return true;
}

/**
 * "Each column head shows its utilisation, in per cent. This is the operating
 * figure for the model's weekend-share assumption, so it is also written to
 * events daily." One row per India date, written once, the day after it closed,
 * so the figure is the day as it was worked and not as it was booked.
 */
export async function recordUtilisation(db: D1Database, now: Date): Promise<string | null> {
  const date = addDays(indiaDate(now), -1);
  const held = await db
    .prepare("SELECT 1 FROM events WHERE name = 'dispatch_utilisation' AND subject_id = ?1")
    .bind(date)
    .first();
  if (held !== null) return null;

  const board = await dispatchBoard(db, { from: date, city: null });
  const day = board.utilisation.find((entry) => entry.date === date);
  await db
    .prepare("INSERT INTO events (id, created_at, name, subject_id, payload_json) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(
      crypto.randomUUID(),
      now.toISOString(),
      "dispatch_utilisation",
      date,
      JSON.stringify({
        percent: day?.percent ?? 0,
        technicians: board.technicians.length,
        slots_per_day: SLOTS_PER_DAY,
      }),
    )
    .run();
  return date;
}

/** FSM's service resource for one of our technicians. */
async function fsmResourceId(db: D1Database, technicianId: string): Promise<string> {
  const row = await db
    .prepare("SELECT fsm_id FROM technicians WHERE id = ?1")
    .bind(technicianId)
    .first<{ fsm_id: string }>();
  if (row === null) throw new Error("the technician is not in FSM");
  return row.fsm_id;
}
