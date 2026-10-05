// The dispatch board, and the two writes ops make on it
// (src/policy/dispatch.ts, docs/decisions/0034-clash-check.md,
// docs/decisions/0069-dispatch-under-concurrency.md).
//
// "Rows are technicians; columns are seven days; each day has config
// SLOTS_PER_DAY (4) slots." The blocks come from the visits, the holds from
// slot_claims, and the clash check is the same one self-serve booking runs, so
// the two cannot disagree. A job is as long as its service, or as its booked
// window where that is longer, and is sized, placed and moved by that length
// (docs/decisions/0085-services-ops-can-edit.md).
//
// "A technician cannot hold two live jobs in one window on one date": the
// refusal below happens before anything is written. A technician on leave is
// refused the same way, and named as away rather than busy (ADR 0062); a free
// window with no room for the visit is named as that. A move is one batch: its
// claim on the new time, the visit and the client's message. "The client's
// payment carries over and he is never charged for a move ops make", so no
// amount is read or written here at all: a visit carries a badge, never a
// figure. A visit the technician has begun is not moved, unless he has only
// checked in and ops, warned, choose to clear his check-in: he checks in again
// at the new time. Nor is a visit whose client has paid for a move, or booked
// one free, that waits to be booked: ops are told it is being moved.

import { failedNotNullOn, failedUniqueOn } from "../lib/d1-errors.ts";
import { BOOKING_WINDOWS, SLOTS_PER_DAY, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaTime } from "../lib/india-time.ts";
import {
  begunFrom,
  clientNotice,
  keepsTheClientsNotice,
  moveRefusal,
  slotsFor,
  targetTime,
  type Begun,
  type ClientNotice,
  type MoveReason,
  type MoveRefusal,
  type TargetTime,
  type UntoldReason,
} from "../policy/dispatch.ts";
import { reachesCity, type PlacesReached } from "../policy/access.ts";
import { paymentBadge, type PaymentBadge } from "../policy/job-visibility.ts";
import { paidAtTheVisit, type OneVisitState } from "../policy/one-visit.ts";
import { FREE_CHANGE_NOTICE_HOURS } from "../policy/moving-a-visit.ts";
import { namesMoreThanItsKind } from "../policy/services.ts";
import { unitsFor } from "../policy/visit-length.ts";
import { auditStatement, type AuditEntry } from "./audit.ts";
import { boardCities } from "./cities.ts";
import { reachBinding, withinReach } from "./places.ts";
import type { AppointmentStatus } from "./visit-status.ts";
import { leaveBetween } from "./leave.ts";
import {
  activeTechnicians,
  bookedMinutes,
  claimsOf,
  fitsAt,
  loadBlackouts,
  occupancy,
  placement,
  type Day,
} from "./occupancy.ts";
import { lettingGo } from "./hold-slot.ts";
import { visitTimes } from "./visit-times.ts";
import { latestConsentSql } from "./consents.ts";
import { begunPastArrival, visitBegun } from "./visit-begun.ts";
import { NO_VISITS_CONSENT, visitMessage } from "./visit-messages.ts";
import { firstUnitAfter, unitAt, type SlotTimes } from "../policy/slot-times.ts";
import { loadSlotSchedule, type SlotSchedule } from "./slot-times.ts";
import { MINUTE_MS } from "../lib/durations.ts";
import { paidNotBooked } from "./hold-stages.ts";
import { statusIn, VISIT_NOT_BEGUN } from "../config/statuses.ts";
import { creditSpentOn } from "./visit-facts.ts";

/** Seven days, as the board shows them. */
export const BOARD_DAYS = 7;

/**
 * The client of a visit, as ops need him to reach him (board A3's WhatsApp and
 * Open client). None for a visit with no client on our records, or one erased.
 */
interface BoardClient {
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
  /** Its service's name in the console, where it names more than the kind: a first fit's hair system, say. */
  readonly service: string | null;
  /** "Rohit M.", as the board writes a client on a block. */
  readonly client: string | null;
  /** The area the visit's pincode is in, where the service area names it; else the address's locality or the city. */
  readonly sector: string | null;
  readonly pincode: string | null;
  readonly person: BoardClient | null;
  readonly badge: PaymentBadge;
  /** The visit's size on the board, from its length: 1, 1, 1.5 and 2 for the kinds' own. */
  readonly slots: number;
  /** The client's note to the technician, as they last wrote it; null for none. */
  readonly client_note: string | null;
}

interface Block extends Visit {
  readonly starts_at: string;
  readonly window: BookingWindow;
  readonly status: AppointmentStatus;
  /** The notice the visit was sold under, in hours: inside it, a change of the client's own costs them. */
  readonly notice_hours: number;
  /** The latest move of this visit that its client has not heard of, and why: ops call him (src/policy/dispatch.ts). */
  readonly untold: { readonly move_id: string; readonly starts_at: string; readonly reason: UntoldReason } | null;
  /** How far the technician has got, from his phone's steps; null before he arrives. A visit begun is not moved. */
  readonly begun: Begun | null;
}

interface BoardDay {
  readonly date: string;
  readonly blocks: Block[];
}

interface BoardRow {
  readonly technician_id: string;
  readonly name: string;
  readonly initials: string;
  readonly zone: string | null;
  readonly days: BoardDay[];
}

interface UnassignedJob extends Visit {
  readonly starts_at: string;
  readonly asked_window: BookingWindow | null;
  readonly offered_window: BookingWindow | null;
  readonly date: string | null;
  /** The technician it is still on, who was switched off and has no row; null for a job nobody holds. */
  readonly was_technician: { readonly id: string; readonly name: string } | null;
}

interface Board {
  /** The board's version when this was read: it goes up whenever something the board draws changes. */
  readonly version: number;
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
   * away for exactly the days it is (ADR 0062).
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
  AND m.now_start = a.window_start AND (m.message_id IS NULL OR EXISTS (
    SELECT 1 FROM outbound_messages o WHERE o.id = m.message_id AND o.state IN ('skipped', 'failed')))
  AND NOT EXISTS (
    SELECT 1 FROM dispatch_moves later
    WHERE later.appointment_id = m.appointment_id AND later.fsm_write_state = 'written'
      AND later.was_start <> later.now_start AND later.created_at > m.created_at)`;

/**
 * Why the client of an untold move `m` has not heard of it, as UNTOLD_REASONS names it: no message was queued, since
 * he had not agreed to WhatsApp about his visits, or the one queued was skipped as he had taken that back; any other
 * message skipped or failed is not_sent. The Tasks board reads the same (src/domain/tasks.ts).
 */
export const UNTOLD_REASON = `CASE WHEN m.message_id IS NULL OR EXISTS (
    SELECT 1 FROM outbound_messages o WHERE o.id = m.message_id AND o.last_error = '${NO_VISITS_CONSENT}')
  THEN 'no_consent' ELSE 'not_sent' END`;

/** The statuses of a job still to finish. One under way is live, though it is not moved. */
const LIVE = "('scheduled', 'dispatched', 'in_progress')";
/** What a day on the board holds: its live jobs, and the ones already done, so a past day reads as it was worked. */
const ON_THE_BOARD = "('scheduled', 'dispatched', 'in_progress', 'completed')";

/** Whether the technician's phone has landed a step of this kind on job `a`, set-aside steps apart. */
const landed = (kind: string): string =>
  `EXISTS (SELECT 1 FROM job_events e WHERE e.appointment_id = a.id AND e.kind = '${kind}' AND e.superseded = 0)`;

/**
 * Each job on the board, with its client, the area its pincode is in, its
 * length, and its badge: Credit where a service-visit credit paid for it, Free
 * where the price book charges nothing for its own service on its day, as the
 * technician's card reads them (src/domain/tech-jobs.ts). No amount leaves the
 * database. A job is the standard tier's where it names no other.
 */
const BOARD_JOBS = `
  SELECT a.id, a.type, a.tier, a.one_visit, a.status, a.window_start, a.window_end, a.technician_id, a.service_city,
    a.service_pincode, a.asked_window, a.person_id, a.client_note, d.locality, sp.area, s.minutes AS service_minutes,
    s.name AS service_name,
    p.name AS client_name, p.mobile_e164 AS client_mobile, p.erased_at AS client_erased_at,
    t.name AS technician_name, t.active AS technician_active,
    ${LATEST_VISITS_CONSENT} AS whatsapp_visits,
    (SELECT referrer.name FROM referral_attributions r
       JOIN referral_codes code ON code.code = r.code
       JOIN people referrer ON referrer.id = code.person_id
     WHERE r.referred_person_id = a.person_id AND referrer.erased_at IS NULL) AS referred_by,
    ${creditSpentOn("a.id")} AS on_credit,
    (SELECT COALESCE(h.change_notice_hours, ?4) FROM slot_holds h
     WHERE h.appointment_id = a.id AND h.state = 'booked' ORDER BY h.updated_at DESC LIMIT 1) AS sold_notice_hours,
    COALESCE((SELECT b.amount_ex_gst = 0 FROM price_book b
              WHERE b.item = a.type AND b.tier = COALESCE(a.tier, 'standard')
                AND b.valid_from <= date(a.window_start, '+330 minutes')
              ORDER BY b.valid_from DESC LIMIT 1), 0) AS free,
    ${landed("check_in")} AS checked_in, ${landed("start")} AS started, ${landed("outcome")} AS closed
  FROM appointments a LEFT JOIN people p ON p.id = a.person_id
  LEFT JOIN technicians t ON t.id = a.technician_id
  LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
  LEFT JOIN serviceable_pincodes sp ON sp.pincode = a.service_pincode
  LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
  WHERE a.deleted_at IS NULL AND a.status IN ${ON_THE_BOARD} AND a.window_start >= ?1 AND a.window_start < ?2
    AND (?3 IS NULL OR a.service_city = ?3) AND ${withinReach("visit", "a", "?5")}
  ORDER BY a.window_start`;

/** The board's seven days from `from`. */
const weekFrom = (from: string): string[] => Array.from({ length: BOARD_DAYS }, (_, index) => addDays(from, index));

/** The technicians on the board, each with whether staff access by place reaches him (1) or not (0). */
const BOARD_TECHNICIANS = `SELECT id, name, initials, zone, ${withinReach("technician", "t", "?1")} AS reached
  FROM technicians t WHERE active = 1 ORDER BY name`;

const EVERYWHERE: PlacesReached = { kind: "everywhere" };

/**
 * A number that triggers raise whenever a visit, move, leave, technician or the day's slot times change, so the open
 * board reads itself again only when it has moved.
 */
export async function boardVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT version FROM board_version WHERE id = 1").first<{ version: number }>();
  return row?.version ?? 0;
}

/**
 * The board for seven days from `from`, optionally narrowed to one city. `noticeHours` is the notice in force, which a
 * visit no hold sold is changed under (src/domain/visit-changes.ts).
 *
 * `reach` keeps it to the caller's cities: their visits, and the technicians there or holding one of those visits.
 */
export async function dispatchBoard(
  db: D1Database,
  options: { from: string; city: string | null; noticeHours?: number; reach?: PlacesReached },
): Promise<Board> {
  const reach = options.reach ?? EVERYWHERE;
  const dates = weekFrom(options.from);
  const last = dates[dates.length - 1] ?? options.from;
  const fromAt = indiaInstant(options.from, "00:00").toISOString();
  const toAt = indiaInstant(addDays(last, 1), "00:00").toISOString();

  // Read before the board, so a change made while it is read moves the version past this one.
  const version = await boardVersion(db);
  const [technicians, scheduled, untold, cities, schedule] = await Promise.all([
    db
      .prepare(BOARD_TECHNICIANS)
      .bind(reachBinding(reach))
      .all<{ id: string; name: string; initials: string; zone: string | null; reached: number }>(),
    db
      .prepare(BOARD_JOBS)
      .bind(fromAt, toAt, options.city, FREE_CHANGE_NOTICE_HOURS, reachBinding(reach))
      .all<BoardJobRow>(),
    db
      .prepare(
        `SELECT m.id, m.appointment_id, m.now_start, ${UNTOLD_REASON} AS reason FROM appointments a
         JOIN dispatch_moves m ON m.appointment_id = a.id
         WHERE a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.window_start >= ?1 AND a.window_start < ?2
           AND ${UNTOLD_MOVE}`,
      )
      .bind(fromAt, toAt)
      .all<{ id: string; appointment_id: string; now_start: string; reason: UntoldReason }>(),
    boardCities(db),
    loadSlotSchedule(db),
  ]);
  const untoldOf = (appointmentId: string) => {
    const move = untold.results.find((each) => each.appointment_id === appointmentId);
    return move === undefined ? null : { move_id: move.id, starts_at: move.now_start, reason: move.reason };
  };

  const holding = new Set(scheduled.results.map((job) => job.technician_id));
  const shown = technicians.results.filter((technician) => technician.reached === 1 || holding.has(technician.id));
  const rows = shown.map((technician): BoardRow => {
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
  const onTheBoard = (period: { technician_id: string }) => shown.some((row) => row.id === period.technician_id);
  const leave = (await leaveBetween(db, options.from, last)).filter(onTheBoard).map((period) => ({
    technician_id: period.technician_id,
    // Clipped to the week, so the board draws the days it has columns for and no others.
    from: period.from < options.from ? options.from : period.from,
    to: period.to > last ? last : period.to,
    note: period.note,
  }));
  return {
    version,
    from: options.from,
    dates,
    city: options.city,
    cities: cities.filter((city) => reachesCity(reach, city)),
    technicians: rows,
    unassigned,
    utilisation: utilisationOf(rows, dates, leave),
    leave,
  };
}

interface BoardJobRow {
  id: string;
  client_note: string | null;
  type: VisitType | null;
  /** Its service's tier; null where the mirror knows none, which is the standard tier's. */
  tier: string | null;
  service_name: string | null;
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
  /** 1 where the technician's phone has landed that step. */
  checked_in: number;
  started: number;
  closed: number;
}

function visitOf(job: BoardJobRow): Visit {
  return {
    appointment_id: job.id,
    type: job.type,
    service: namesMoreThanItsKind(job.tier, job.one_visit) ? job.service_name : null,
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
    // An erased client's note went with them.
    client_note: job.client_erased_at === null ? job.client_note : null,
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
    begun: begunFrom({ checkIn: job.checked_in === 1, start: job.started === 1, outcome: job.closed === 1 }),
  };
}

/**
 * A job no technician on the board holds: none was given it, or the one it is on was switched off with visits still
 * on him. Either way it waits in the tray.
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
 * its city's jobs; the technicians only to the caller's cities, since any may be
 * sent anywhere (docs/decisions/0069-dispatch-under-concurrency.md).
 */
function utilisationOf(
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
  /**
   * Set when ops, warned that the technician has checked in, move the visit anyway: his check-in is cleared, and this
   * entry records who chose it. Absent for an ordinary move.
   */
  readonly clearCheckIn?: AuditEntry | null;
  /** Why ops move the visit onto a day they blacked out, as they typed it; absent for any other day. */
  readonly blackoutReason?: string | null;
}

/**
 * What changed under a board since it was loaded: the job's technician, its
 * time, or another move of it still being written.
 */
type Change = "technician" | "time" | "moving";

type MoveOutcome =
  | { readonly kind: "moved"; readonly moveId: string; readonly clientNotice: ClientNotice }
  | { readonly kind: "refused"; readonly reason: MoveRefusal }
  | { readonly kind: "not_found" }
  /** A job in the tray, sent with no technician to put it on. */
  | { readonly kind: "no_technician" }
  /** The board the move was made from no longer shows the job as it is; nothing was written. */
  | { readonly kind: "superseded"; readonly changed: readonly Change[] }
  /** The move names the technician, day and window the job already has. */
  | { readonly kind: "nothing_to_move" }
  /** The technician has begun the visit, so it stays where it is; nothing was written. */
  | { readonly kind: "in_progress" };

/** Where a move puts a job, and whether it keeps the time it has. */
interface Target {
  readonly technicianId: string;
  readonly date: string;
  readonly window: BookingWindow;
  /** Only the technician changes: the visit keeps its own start, still ahead, and its half-slots are checked there. */
  readonly keepsTime: boolean;
  /** The target day's times, which its half-slots are read by. */
  readonly times: SlotTimes;
  /** The first half-slot the visit may start in there: any on a day ahead, only one still to start today. */
  readonly earliest: number;
  readonly time: TargetTime;
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
  if (!target.keepsTime) return placement(day, target.window, units, target.earliest);
  const start = unitAt(indiaTime(job.start), target.times);
  return fitsAt(day, start, units) ? start : null;
}

/** Where the job lands on the target's day, or why it cannot. */
function landingOf(day: Day, job: Placing, target: Target, blackoutWithoutReason = false): Landing {
  const start = startOn(day, job, target);
  const refusal = moveRefusal(day, target.window, { time: target.time, fits: start !== null, blackoutWithoutReason });
  if (refusal !== null) return { kind: "refused", reason: refusal };
  return start === null ? { kind: "refused", reason: "does_not_fit" } : { kind: "lands", start };
}

/** When the job starts and ends where it lands: its own times where it keeps them, else from its half-slot there. */
function timesAt(target: Target, startUnit: number, job: Placing, schedule: SlotSchedule): { start: Date; end: Date } {
  if (!target.keepsTime) return visitTimes(target.date, startUnit, job.minutes, schedule);
  return { start: job.start, end: new Date(job.start.getTime() + job.minutes * MINUTE_MS) };
}

interface MoveDeps {
  /** Queues the client's "your visit is now …" message. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

interface LiveJob {
  id: string;
  person_id: string | null;
  type: VisitType;
  status: AppointmentStatus;
  window_start: string;
  window_end: string | null;
  start_before_move: string | null;
  technician_id: string | null;
  service_minutes: number | null;
  /** 1 once the technician has begun it (src/domain/visit-begun.ts). */
  begun: number;
  /** 1 once he has begun it by more than his check-in. */
  begun_past_arrival: number;
  /** 1 while a move the client has paid for, or booked free, waits to be booked onto it. */
  client_moving: number;
}

/**
 * Whether a move the client has paid for, or booked free, waits to be booked onto visit `a`. It is booked onto the visit
 * as it was when the client chose the time, so ops' move waits for it.
 */
const CLIENT_MOVING = `EXISTS (SELECT 1 FROM slot_holds h WHERE h.moves_appointment_id = a.id AND ${paidNotBooked("h")})`;

/** A job still to finish; null for one done, cancelled, deleted, or with no type or time. */
function liveJob(db: D1Database, appointmentId: string): Promise<LiveJob | null> {
  return db
    .prepare(
      `SELECT a.id, a.person_id, a.type, a.status, a.window_start, a.window_end, a.start_before_move,
         a.technician_id, s.minutes AS service_minutes, ${visitBegun("a")} AS begun,
         ${begunPastArrival("a")} AS begun_past_arrival, ${CLIENT_MOVING} AS client_moving
       FROM appointments a LEFT JOIN services s ON s.kind = a.type AND s.tier = COALESCE(a.tier, 'standard')
       WHERE a.id = ?1 AND a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.type IS NOT NULL
         AND a.window_start IS NOT NULL`,
    )
    .bind(appointmentId)
    .first<LiveJob>();
}

/**
 * A job the technician has begun, by his phone's steps or its status, stays where he is working it: moved, his phone
 * would carry on with a visit now on another day or another technician's.
 */
const isUnderWay = (job: LiveJob): boolean => job.status === "in_progress" || job.begun === 1;

/** A job begun by the technician's check-in and nothing more: ops may still move it by clearing the check-in. */
const isOnlyCheckedIn = (job: LiveJob): boolean =>
  job.status !== "in_progress" && job.begun === 1 && job.begun_past_arrival === 0;

/** Whether the job may move as it is: not begun, or only checked in and ops chose to clear the check-in. */
const mayMove = (job: LiveJob, clearingCheckIn: boolean): boolean =>
  !isUnderWay(job) || (clearingCheckIn && isOnlyCheckedIn(job));

/**
 * Where a move puts the job. A day and window that are the job's own keep its start while that start is still ahead:
 * only the technician changes. Otherwise the job takes the window's first free half-slot still to start.
 */
function targetOf(
  job: LiveJob,
  technicianId: string,
  place: { readonly date: string; readonly window: BookingWindow },
  schedule: SlotSchedule,
  now: Date,
): Target {
  const { date, window } = place;
  const was = schedule.at(job.window_start);
  const today = schedule.at(now);
  const times = schedule.on(date);
  const startIsAhead = Date.parse(job.window_start) > now.getTime();
  const keepsTime = date === was.date && window === was.window && startIsAhead;
  const earliest = date === today.date ? firstUnitAfter(today.time, times) : 0;
  const time = keepsTime ? "ahead" : targetTime(place, { date: today.date, firstUnitAhead: earliest });
  return { technicianId, date, window, keepsTime, times, earliest, time };
}

/** Whether the move puts the job onto a day ops blacked out, from another day. */
async function movesOntoBlackout(db: D1Database, job: LiveJob, date: string): Promise<boolean> {
  if (date === indiaDate(new Date(job.window_start))) return false;
  return (await loadBlackouts(db, date, date)).has(date);
}

/** Where the job already is: no move at all. */
const isWhereItIs = (job: LiveJob, target: Target): boolean =>
  target.keepsTime && target.technicianId === job.technician_id;

/** A move that passed its checks: the job, where it goes, and the time it claims there. */
interface PlannedMove {
  readonly id: string;
  readonly job: LiveJob;
  readonly technicianId: string;
  readonly reason: MoveReason;
  /** The Access identity that made the move (ADR 0031). */
  readonly actor: string;
  /** When the visit starts and ends once moved. */
  readonly start: Date;
  readonly end: Date;
  /** Only the technician changes. */
  readonly keepsTime: boolean;
  /** The India date of the technician's day the move claims, and its half-slots there. */
  readonly date: string;
  readonly claims: readonly string[];
  /** The audit entry for clearing the technician's check-in; null when he had not checked in. */
  readonly clearCheckIn: AuditEntry | null;
  /** Why ops moved it onto a day they blacked out; null for any other day. */
  readonly blackoutReason: string | null;
}

/**
 * Assigns or moves one job: the checks, then the move written. Assigning and moving are the same write; only what the
 * caller changes differs.
 */
export async function moveJob(db: D1Database, deps: MoveDeps, input: MoveInput, now: Date): Promise<MoveOutcome> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null) return { kind: "not_found" };
  const changed = changedSince(job, input.expected);
  if (changed.length > 0) return { kind: "superseded", changed };
  if (job.client_moving === 1) return { kind: "superseded", changed: ["moving"] };
  const clearCheckIn = input.clearCheckIn ?? null;
  if (!mayMove(job, clearCheckIn !== null)) return { kind: "in_progress" };

  const wasStart = new Date(job.window_start);
  const technicianId = input.technicianId ?? job.technician_id;
  if (technicianId === null) return { kind: "no_technician" };
  const schedule = await loadSlotSchedule(db);
  // What ops left out keeps what the job has.
  const date = input.date ?? indiaDate(wasStart);
  const window = input.window ?? schedule.at(wasStart).window;
  const target = targetOf(job, technicianId, { date, window }, schedule, now);
  if (isWhereItIs(job, target)) return { kind: "nothing_to_move" };

  // The check runs before anything is written. The job's own time does not
  // count against its own move.
  const [held, ontoBlackout] = await Promise.all([
    occupancy(db, date, date, now, job.id),
    movesOntoBlackout(db, job, date),
  ]);
  const blackoutReason = ontoBlackout ? (input.blackoutReason ?? null) : null;
  const placing = { minutes: bookedMinutes(job), start: wasStart };
  const landing = landingOf(held(technicianId, date), placing, target, ontoBlackout && blackoutReason === null);
  if (landing.kind === "refused") return landing;

  const times = timesAt(target, landing.start, placing, schedule);
  const move: PlannedMove = {
    id: crypto.randomUUID(),
    job,
    technicianId,
    reason: input.reason,
    actor: input.actor,
    start: times.start,
    end: times.end,
    keepsTime: target.keepsTime,
    date,
    claims: claimsOf(landing.start, unitsFor(placing.minutes), window),
    clearCheckIn: isUnderWay(job) ? clearCheckIn : null,
    blackoutReason,
  };
  return writeMove(db, deps, move, now);
}

/**
 * Moves a job in one batch: the move, its claim on the new time, the visit and the client's message. The claim is the clash test: a hold or another move that took the time since it was checked fails the
 * batch. It is let go in the same batch, since the visit's own row now holds the time. A visit changed or begun since
 * it was read fails the batch as well, and nothing is written.
 */
async function writeMove(db: D1Database, deps: MoveDeps, move: PlannedMove, now: Date): Promise<MoveOutcome> {
  const at = now.toISOString();
  const told = await clientToldOf(db, move, now);
  try {
    await db.batch([
      ...lettingGo(db, now),
      // The message row is written before the move points at it.
      ...(told.message === null ? [] : [told.message.statement]),
      writtenMove(db, move, told.message?.id ?? null, at),
      ...move.claims.map((claim) => claimOf(db, move, claim)),
      movedVisit(db, move, at),
      releasingClaims(db, move.id),
      ...checkInCleared(db, move, now),
    ]);
  } catch (error) {
    if (failedUniqueOn(error, "slot_claims")) return { kind: "refused", reason: "clash" };
    if (failedNotNullOn(error, "dispatch_moves.appointment_id")) return changedUnder(db, move);
    throw error;
  }
  if (told.message !== null) await deps.notify?.(told.message.id);
  return { kind: "moved", moveId: move.id, clientNotice: told.notice };
}

/**
 * The move, recorded as written. It names its visit only while the visit is as the move read it, not yet begun, or
 * begun by no more than the check-in it clears, and no move of the client's waits on it; otherwise its visit is empty,
 * which the table refuses, and the batch it is in writes nothing.
 */
function writtenMove(db: D1Database, move: PlannedMove, messageId: string | null, at: string): D1PreparedStatement {
  const { job } = move;
  const begun = move.clearCheckIn === null ? visitBegun("a") : begunPastArrival("a");
  return db
    .prepare(
      `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
         reason, actor, fsm_write_state, message_id, created_at, updated_at, blackout_reason)
       VALUES (?1,
         (SELECT a.id FROM appointments a
          WHERE a.id = ?2 AND a.technician_id IS ?3 AND a.window_start = ?5 AND a.deleted_at IS NULL
            AND ${statusIn("a.status", VISIT_NOT_BEGUN)} AND NOT ${begun} AND NOT ${CLIENT_MOVING}),
         ?3, ?4, ?5, ?6, ?7, ?8, 'written', ?9, ?10, ?10, ?11)`,
    )
    .bind(
      move.id,
      job.id,
      job.technician_id,
      move.technicianId,
      job.window_start,
      move.start.toISOString(),
      move.reason,
      move.actor,
      messageId,
      at,
      move.blackoutReason,
    );
}

/** Why a move found its visit changed under it, read again as the checks before the write read it. */
async function changedUnder(db: D1Database, move: PlannedMove): Promise<MoveOutcome> {
  const job = await liveJob(db, move.job.id);
  if (job === null) return { kind: "not_found" };
  const changed = changedSince(job, { technicianId: move.job.technician_id, startsAt: move.job.window_start });
  if (changed.length > 0) return { kind: "superseded", changed };
  if (!mayMove(job, move.clearCheckIn !== null)) return { kind: "in_progress" };
  return { kind: "superseded", changed: ["moving"] };
}

/**
 * Clears the technician's check-in once the move is written: every step his phone landed on the visit is set aside,
 * the check-in all there is, so he checks in again where the visit now is. The audit log names who chose it.
 */
function checkInCleared(db: D1Database, move: PlannedMove, now: Date): D1PreparedStatement[] {
  if (move.clearCheckIn === null) return [];
  const entry: AuditEntry = { ...move.clearCheckIn, detail: { move_id: move.id } };
  return [
    db
      .prepare("UPDATE job_events SET superseded = 1, updated_at = ?2 WHERE appointment_id = ?1 AND superseded = 0")
      .bind(move.job.id, now.toISOString()),
    auditStatement(db, entry, now),
  ];
}

/** The visit where the move puts it. */
function movedVisit(db: D1Database, move: PlannedMove, at: string): D1PreparedStatement {
  const { job } = move;
  return db
    .prepare(
      `UPDATE appointments SET technician_id = ?2, window_start = ?3, window_end = ?4, synced_at = ?5,
         start_before_move = ?6
       WHERE id = ?1`,
    )
    .bind(
      job.id,
      move.technicianId,
      move.start.toISOString(),
      move.end.toISOString(),
      at,
      move.keepsTime ? job.start_before_move : startBeforeMoving(job, move.reason),
    );
}

/** How the client hears of the move: the notice, and the message row where he is messaged. */
async function clientToldOf(
  db: D1Database,
  move: PlannedMove,
  now: Date,
): Promise<{ notice: ClientNotice; message: { id: string; statement: D1PreparedStatement } | null }> {
  const { job } = move;
  const notice = clientNotice({
    timeChanged: !move.keepsTime,
    client: job.person_id === null ? null : { agreedToWhatsApp: await agreedToVisitMessages(db, job.id) },
  });
  if (notice !== "messaged" || job.person_id === null) return { notice, message: null };
  return {
    notice,
    message: visitMessage(db, { personId: job.person_id, appointmentId: job.id, kind: "visit_moved", now }),
  };
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

/** One half-slot of the technician's day, claimed for the move under the key holds use. */
const claimOf = (db: D1Database, move: PlannedMove, claim: string): D1PreparedStatement =>
  db
    .prepare("INSERT INTO slot_claims (technician_id, date, claim, move_id) VALUES (?1, ?2, ?3, ?4)")
    .bind(move.technicianId, move.date, claim, move.id);

const releasingClaims = (db: D1Database, moveId: string): D1PreparedStatement =>
  db.prepare("DELETE FROM slot_claims WHERE move_id = ?1").bind(moveId);

/** A window the job would land in, and when it would start there. */
interface RoomStart {
  readonly window: BookingWindow;
  readonly starts_at: string;
}

interface Room {
  readonly technician_id: string;
  readonly date: string;
  /** The windows the job would land in, by the check a move runs. */
  readonly windows: BookingWindow[];
  readonly starts: RoomStart[];
}

interface Rooms {
  readonly rooms: Room[];
  /** The days of the week ops blacked out, other than the job's own: a move onto one needs a reason. */
  readonly blackouts: string[];
}

/**
 * Where a job in hand can go in the week from `from`: each technician's day
 * with a window the job would land in, by the same check a move runs, so the
 * board offers no window the move would be refused. Not where it already is.
 * Null for a job no longer live, or one the technician has begun by more than
 * his check-in, which no move takes.
 */
export async function dispatchRoomFor(
  db: D1Database,
  input: { readonly appointmentId: string; readonly from: string },
  now: Date,
): Promise<Rooms | null> {
  const job = await liveJob(db, input.appointmentId);
  if (job === null || !mayMove(job, true)) return null;
  const dates = weekFrom(input.from);
  const to = dates[dates.length - 1] ?? input.from;
  const [technicians, held, schedule, blackouts] = await Promise.all([
    activeTechnicians(db),
    occupancy(db, input.from, to, now, job.id),
    loadSlotSchedule(db),
    loadBlackouts(db, input.from, to),
  ]);
  const visit = { minutes: bookedMinutes(job), start: new Date(job.window_start) };
  const startsFor = (technicianId: string, date: string): RoomStart[] =>
    BOOKING_WINDOWS.flatMap((window) => {
      const target = targetOf(job, technicianId, { date, window }, schedule, now);
      if (isWhereItIs(job, target)) return [];
      const landing = landingOf(held(technicianId, date), visit, target);
      if (landing.kind === "refused") return [];
      return [{ window, starts_at: timesAt(target, landing.start, visit, schedule).start.toISOString() }];
    });
  const roomOn = (technicianId: string, date: string): Room => {
    const starts = startsFor(technicianId, date);
    return { technician_id: technicianId, date, windows: starts.map((each) => each.window), starts };
  };
  const ownDate = indiaDate(visit.start);
  return {
    rooms: technicians
      .flatMap((technician) => dates.map((date) => roomOn(technician.id, date)))
      .filter((room) => room.starts.length > 0),
    blackouts: dates.filter((date) => blackouts.has(date) && date !== ownDate),
  };
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
