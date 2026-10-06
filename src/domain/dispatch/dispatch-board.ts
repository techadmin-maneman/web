// The dispatch board as ops read it (src/policy/dispatch.ts): "Rows are technicians; columns are seven days; each day
// has config SLOTS_PER_DAY (4) slots." The blocks come from the visits and the holds from slot_claims; a job is sized
// by its service's length, or its booked window's where that is longer. The jobs nobody holds yet sit in the tray,
// and each day says how much of its technicians' time is taken. A move is dispatch.ts.

import { type BookingWindow, SLOTS_PER_DAY } from "../../config/scheduling.ts";
import type { VisitType } from "../../config/visit-types.ts";
import { addDays, indiaInstant, indiaDate } from "../../lib/india-time.ts";
import { type PlacesReached, reachesCity } from "../../policy/access.ts";
import { type UntoldReason, type Begun, slotsFor, begunFrom } from "../../policy/dispatch.ts";
import { type PaymentBadge, paymentBadge } from "../../policy/job-visibility.ts";
import { FREE_CHANGE_NOTICE_HOURS } from "../../policy/moving-a-visit.ts";
import { type OneVisitState, paidAtTheVisit } from "../../policy/one-visit.ts";
import { namesMoreThanItsKind } from "../../policy/services.ts";
import { unitsFor } from "../../policy/visit-length.ts";
import { bookedMinutes } from "../booking/occupancy.ts";
import { loadSlotSchedule, type SlotSchedule } from "../booking/slot-times.ts";
import { withinReach, reachBinding } from "../clients/places.ts";
import { NO_VISITS_CONSENT } from "../messages/visit-messages.ts";
import { latestConsentSql } from "../privacy/consents.ts";
import { creditSpentOn } from "../visits/visit-facts.ts";
import type { AppointmentStatus } from "../visits/visit-status.ts";
import { boardCities } from "./cities.ts";
import { leaveBetween } from "./leave.ts";

/** Seven days, as the board shows them. */
export const BOARD_DAYS = 7;
/**
 * The client of a visit, as ops need them to reach them (the job card's WhatsApp
 * and Open client). None for a visit with no client on our records, or one erased.
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
 * gave one. The messaging consumer reads it the same way before it sends (src/domain/messages/visit-messages.ts).
 */
export const LATEST_VISITS_CONSENT = latestConsentSql("a.person_id", "whatsapp_visits");
/**
 * A move `m` of appointment `a` whose client has not heard of it: its day or window changed, no message was
 * queued or the one queued was never sent, ops have not said they called, and it still stands, since no later
 * move changed the time and the visit is still at the time it moved to. The Tasks board reads the same
 * (src/domain/ops/tasks.ts).
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
 * message skipped or failed is not_sent. The Tasks board reads the same (src/domain/ops/tasks.ts).
 */
export const UNTOLD_REASON = `CASE WHEN m.message_id IS NULL OR EXISTS (
    SELECT 1 FROM outbound_messages o WHERE o.id = m.message_id AND o.last_error = '${NO_VISITS_CONSENT}')
  THEN 'no_consent' ELSE 'not_sent' END`;
/** The statuses of a job still to finish. One under way is live, though it is not moved. */
export const LIVE = "('scheduled', 'dispatched', 'in_progress')";
/** What a day on the board holds: its live jobs, and the ones already done, so a past day reads as it was worked. */
const ON_THE_BOARD = "('scheduled', 'dispatched', 'in_progress', 'completed')";
/** Whether the technician's phone has landed a step of this kind on job `a`, set-aside steps apart. */
const landed = (kind: string): string =>
  `EXISTS (SELECT 1 FROM job_events e WHERE e.appointment_id = a.id AND e.kind = '${kind}' AND e.superseded = 0)`;
/**
 * Each job on the board, with its client, the area its pincode is in, its
 * length, and its badge: Credit where a service-visit credit paid for it, Free
 * where the price book charges nothing for its own service on its day, as the
 * technician's card reads them (src/domain/field/tech-jobs.ts). No amount leaves the
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
export const weekFrom = (from: string): string[] =>
  Array.from({ length: BOARD_DAYS }, (_, index) => addDays(from, index));
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
 * visit no hold sold is changed under (src/domain/visits/visit-changes.ts).
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
