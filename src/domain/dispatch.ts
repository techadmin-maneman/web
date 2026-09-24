// The dispatch board, and the two writes ops make on it
// (src/policy/dispatch.ts, docs/decisions/0034-clash-check.md).
//
// "Rows are technicians; columns are seven days; each day has config
// SLOTS_PER_DAY (4) slots." The blocks come from the FSM mirror, the holds from
// slot_claims, and the clash check is the same one self-serve booking runs, so
// the two cannot disagree.
//
// "A technician cannot hold two live jobs in one window on one date. This check
// runs on the server before any write to FSM": the refusal below happens before
// anything is written anywhere. A technician on leave is refused the same way,
// and named as away rather than busy (ADR 0060). Then FSM, then the mirror,
// then the client's message. "The client's payment carries over and he is never
// charged for a move ops make", so no amount is read or written here at all.

import { SLOTS_PER_DAY, VISIT_BLOCKS, type BookingWindow } from "../config/scheduling.ts";
import type { VisitType } from "../config/visit-types.ts";
import { addDays, indiaDate, indiaInstant, indiaIso, indiaTime } from "../lib/india-time.ts";
import { moveRefusal, slotsFor, type MoveReason, type MoveRefusal } from "../policy/dispatch.ts";
import type { FsmProvider } from "../providers/fsm.ts";
import type { AppointmentStatus } from "./fsm-mirror.ts";
import { leaveBetween } from "./leave.ts";
import { occupancy, placement, unitAt, visitTimes, windowAt } from "./scheduling.ts";
import { visitMessage } from "./visit-messages.ts";

/** Seven days, as the board shows them. */
export const BOARD_DAYS = 7;

export interface Block {
  readonly appointment_id: string;
  readonly type: VisitType | null;
  readonly starts_at: string;
  readonly window: BookingWindow;
  /** The block's size on the board: 1, 1, 1.5 or 2. */
  readonly slots: number;
  readonly status: AppointmentStatus;
  readonly client: string | null;
  readonly sector: string | null;
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

export interface UnassignedJob {
  readonly appointment_id: string;
  readonly type: VisitType | null;
  readonly asked_window: BookingWindow | null;
  readonly offered_window: BookingWindow | null;
  readonly date: string | null;
  readonly sector: string | null;
}

export interface Board {
  readonly from: string;
  readonly dates: string[];
  readonly technicians: BoardRow[];
  readonly unassigned: UnassignedJob[];
  /** Per day: the share of the day's slots taken, across every technician on the board. */
  readonly utilisation: { date: string; percent: number }[];
  /**
   * Leave ops recorded, clipped to the board's own week, so a column is drawn
   * away for exactly the days it is (ADR 0060). It does not come from FSM:
   * FSM's availability answers free time, never the reason for it.
   */
  readonly leave: { technician_id: string; from: string; to: string; note: string | null }[];
}

const LIVE = "('scheduled', 'dispatched', 'in_progress')";

/** The board for seven days from `from`, optionally narrowed to one city. */
export async function dispatchBoard(db: D1Database, options: { from: string; city: string | null }): Promise<Board> {
  const dates = Array.from({ length: BOARD_DAYS }, (_, index) => addDays(options.from, index));
  const last = dates[dates.length - 1] ?? options.from;
  const fromAt = indiaInstant(options.from, "00:00").toISOString();
  const toAt = indiaInstant(addDays(last, 1), "00:00").toISOString();

  const technicians = await db
    .prepare("SELECT id, name, initials, zone FROM technicians WHERE active = 1 ORDER BY name")
    .all<{ id: string; name: string; initials: string; zone: string | null }>();

  const scheduled = await db
    .prepare(
      `SELECT a.id, a.type, a.status, a.window_start, a.technician_id, a.service_city, a.asked_window, d.locality,
         p.name AS client_name
       FROM appointments a
       LEFT JOIN people p ON p.id = a.person_id
       LEFT JOIN addresses d ON d.person_id = a.person_id AND d.replaced_at IS NULL
       WHERE a.deleted_at IS NULL AND a.status IN ${LIVE} AND a.window_start >= ?1 AND a.window_start < ?2
         AND (?3 IS NULL OR a.service_city = ?3)
       ORDER BY a.window_start`,
    )
    .bind(fromAt, toAt, options.city)
    .all<BoardJobRow>();

  const rows = technicians.results.map((technician): BoardRow => {
    const days = dates.map((date) => ({
      date,
      blocks: scheduled.results
        .filter((job) => job.technician_id === technician.id && indiaDate(new Date(job.window_start)) === date)
        .map(blockOf),
    }));
    return {
      technician_id: technician.id,
      name: technician.name,
      initials: technician.initials,
      zone: technician.zone,
      days,
    };
  });

  const unassigned = scheduled.results.filter((job) => job.technician_id === null).map(unassignedOf);
  const leave = await leaveBetween(db, options.from, last);
  return {
    from: options.from,
    dates,
    technicians: rows,
    unassigned,
    utilisation: utilisationOf(rows, dates),
    leave: leave.map((period) => ({
      technician_id: period.technician_id,
      // Clipped to the week, so the board draws the days it has columns for and no others.
      from: period.from < options.from ? options.from : period.from,
      to: period.to > last ? last : period.to,
      note: period.note,
    })),
  };
}

interface BoardJobRow {
  id: string;
  type: VisitType | null;
  status: AppointmentStatus;
  window_start: string;
  technician_id: string | null;
  service_city: string | null;
  locality: string | null;
  client_name: string | null;
  asked_window: BookingWindow | null;
}

function blockOf(job: BoardJobRow): Block {
  const start = new Date(job.window_start);
  return {
    appointment_id: job.id,
    type: job.type,
    starts_at: start.toISOString(),
    window: windowAt(indiaTime(start)),
    slots: slotsFor(job.type ?? "service"),
    status: job.status,
    client: shortName(job.client_name),
    sector: job.locality ?? job.service_city,
  };
}

function unassignedOf(job: BoardJobRow): UnassignedJob {
  const start = new Date(job.window_start);
  return {
    appointment_id: job.id,
    type: job.type,
    // What the client asked for, resolved from the Request behind the visit (ADR
    // 0060). Null where nothing recorded one, and the tray says so in words: the
    // offered window is never repeated as though it were the asked one.
    asked_window: job.asked_window,
    offered_window: windowAt(indiaTime(start)),
    date: indiaDate(start),
    sector: job.locality ?? job.service_city,
  };
}

/** "Rohit M.", as the board writes a client. */
function shortName(name: string | null): string | null {
  if (name === null) return null;
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest[rest.length - 1];
  return last === undefined ? (first ?? null) : `${first ?? ""} ${last.slice(0, 1)}.`;
}

/**
 * "Each column head shows its utilisation, in per cent." The day's slots taken
 * out of the slots the board's technicians have that day.
 */
export function utilisationOf(
  rows: readonly BoardRow[],
  dates: readonly string[],
): { date: string; percent: number }[] {
  return dates.map((date) => {
    const capacity = rows.length * SLOTS_PER_DAY;
    const taken = rows.reduce(
      (total, row) =>
        total + (row.days.find((day) => day.date === date)?.blocks ?? []).reduce((n, b) => n + b.slots, 0),
      0,
    );
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
  readonly reason: string;
  /** The Access identity that made the move (ADR 0031). */
  readonly actor: string;
}

export type MoveOutcome =
  | { readonly kind: "moved"; readonly moveId: string; readonly messageId: string | null }
  | { readonly kind: "refused"; readonly reason: MoveRefusal }
  | { readonly kind: "not_found" }
  /** FSM would not take it: nothing moved, and the refusal is on the record. */
  | { readonly kind: "fsm_refused"; readonly moveId: string };

export interface MoveDeps {
  readonly fsm: FsmProvider;
  readonly labelAsTest: boolean;
  /** Queues the client's "your visit is now …" message. */
  readonly notify?: (messageId: string) => Promise<unknown>;
}

/**
 * Assigns or moves one job: the clash check, then FSM, then the mirror, then
 * the client's message. Assigning and moving are the same write; only what the
 * caller changes differs.
 */
export async function moveJob(db: D1Database, deps: MoveDeps, input: MoveInput, now: Date): Promise<MoveOutcome> {
  const job = await db
    .prepare(
      `SELECT id, fsm_id, person_id, type, status, window_start, technician_id FROM appointments
       WHERE id = ?1 AND deleted_at IS NULL AND status IN ${LIVE} AND type IS NOT NULL AND window_start IS NOT NULL`,
    )
    .bind(input.appointmentId)
    .first<{
      id: string;
      fsm_id: string;
      person_id: string | null;
      type: VisitType;
      status: AppointmentStatus;
      window_start: string;
      technician_id: string | null;
    }>();
  if (job === null) return { kind: "not_found" };

  const wasStart = new Date(job.window_start);
  const technicianId = input.technicianId ?? job.technician_id;
  if (technicianId === null) return { kind: "refused", reason: "unknown_reason" };
  // What ops asked to change; what they left out keeps the time the job has.
  const toDate = input.date ?? null;
  const toWindow = input.window ?? null;
  const date = toDate ?? indiaDate(wasStart);
  const window = toWindow ?? windowAt(indiaTime(wasStart));

  // The check runs on the server before any write to FSM. The job's own time
  // does not count against its own move.
  const held = await occupancy(db, date, date, now, job.id);
  const refusal = moveRefusal(held(technicianId, date), window, input.reason);
  if (refusal !== null) return { kind: "refused", reason: refusal };

  const movesTime = toDate !== null || toWindow !== null;
  const startUnit = movesTime ? placement(held(technicianId, date), window, job.type) : unitAt(indiaTime(wasStart));
  if (startUnit === null) return { kind: "refused", reason: "clash" };
  const times = movesTime ? visitTimes(date, startUnit, job.type) : null;
  const nowStart = times?.start ?? wasStart;

  const at = now.toISOString();
  const moveId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, was_start, now_start,
         reason, actor, fsm_write_state, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?9)`,
    )
    .bind(
      moveId,
      job.id,
      job.technician_id,
      technicianId,
      job.window_start,
      nowStart.toISOString(),
      input.reason as MoveReason,
      input.actor,
      at,
    )
    .run();

  try {
    if (technicianId !== job.technician_id)
      await deps.fsm.assignVisit(job.fsm_id, await fsmResourceId(db, technicianId));
    if (times !== null) {
      await deps.fsm.rescheduleVisit(job.fsm_id, { start: indiaIso(times.start), end: indiaIso(times.end) });
    }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : "unknown error").slice(0, 300);
    await db
      .prepare("UPDATE dispatch_moves SET fsm_write_state = 'rejected', fsm_error = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(moveId, reason, now.toISOString())
      .run();
    return { kind: "fsm_refused", moveId };
  }

  // FSM took it: the mirror follows, and the client is told his new window.
  const message =
    job.person_id === null
      ? null
      : visitMessage(db, { personId: job.person_id, appointmentId: job.id, kind: "visit_moved", now });
  await db.batch([
    db
      .prepare(
        `UPDATE appointments SET technician_id = ?2, window_start = ?3, window_end = ?4, synced_at = ?5
         WHERE id = ?1`,
      )
      .bind(
        job.id,
        technicianId,
        nowStart.toISOString(),
        (times?.end ?? new Date(nowStart.getTime() + VISIT_BLOCKS[job.type].minutes * 60_000)).toISOString(),
        at,
      ),
    // The message row is written before the move points at it.
    ...(message === null ? [] : [message.statement]),
    db
      .prepare("UPDATE dispatch_moves SET fsm_write_state = 'written', message_id = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(moveId, message?.id ?? null, at),
  ]);
  if (message !== null) await deps.notify?.(message.id);
  return { kind: "moved", moveId, messageId: message?.id ?? null };
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
