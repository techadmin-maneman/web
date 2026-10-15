// What ops still have to do (src/policy/tasks.ts), read from the queues the
// database already keeps rather than from a table of its own.
//
// Every group is read in one batch, so the board costs one round trip
// however many tasks it holds, each statement kept to the caller's cities. Each arm gives the same seven columns: the group,
// the row's own id, the client it concerns, the one fact behind it, the moment
// it started waiting, and, for a task about a visit still to come, the visit's
// start. The due date follows from that moment and the group's allowance, and
// is never later than the visit; nothing is written anywhere. Whose each task
// is, where ops made it someone's, is kept apart and read beside it
// (src/domain/ops/task-owners.ts).

import { PARTIAL_REASONS } from "../../config/job-sheet.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { loadSlotSchedule, type SlotSchedule } from "../booking/slot-times.ts";
import {
  atRiskFrom,
  atRiskIfDoneBy,
  firstFitToBookFrom,
  firstFitToBookIfConsultedBy,
  NEXT_VISIT_DAYS,
  offeredWindow,
  serviceDue,
  type NextVisitDays,
} from "../../policy/next-visit.ts";
import { closedIfSentBy } from "../../policy/one-visit.ts";
import { dueAt, type Slas, type TaskGroup } from "../../policy/tasks.ts";
import { CARE_HOURS, type CareHours } from "../../policy/care-hours.ts";
import { overdueChats } from "../care/chat-tasks.ts";
import { reachBinding } from "../clients/places.ts";
import { EVERYWHERE, type PlacesReached } from "../../policy/access.ts";
import { LOST_AFTER_DAYS, lostIfDoneBy } from "../../policy/client-standing.ts";
import { factsOf, type TaskFacts } from "./task-facts.ts";
import { taskWithinReach } from "./task-reach.ts";
import { QUEUES, type Queue, type ReadAt } from "./task-queues.ts";

/** A visit to come, by its id and its start. */
interface TaskVisit {
  readonly id: string;
  readonly starts_at: string;
}

export interface Task {
  readonly id: string;
  readonly group: TaskGroup;
  /**
   * Whose it is; null for an erased client, whose record is gone. The mobile is there only on a move the client has
   * not heard of, for the call.
   */
  readonly person: { readonly id: string; readonly name: string; readonly mobile: string | null } | null;
  /** The visit the dispatch board settles the task on: a move's, a job on leave's. Null for every other group. */
  readonly visit: TaskVisit | null;
  /**
   * The one fact the group turns on: the start a visit moved to, the day and
   * window asked for (and the first fit asked for with them, or the one visit),
   * the piece's label, the fraud rule met, the technician who attended, the
   * invoice in Books, the last visit and the day its next
   * service fell due, the consultation and the window its first fit is offered
   * in, a payment link's state, amount and product, what a disputed charge kept.
   */
  readonly detail: string | null;
  /** What the task turns on, by its group (./task-facts.ts): what `detail` writes as words, as fields. */
  readonly facts: TaskFacts;
  readonly since: string;
  readonly due: string;
  /**
   * Which task it is, where its row can be a new task again once this one has gone: a job's leave, a first fit's
   * consultation. Empty for every other group. Its owner is kept for it alone.
   */
  readonly episode: string;
  /** The Access e-mail of the member of staff it is theirs; null while nobody has taken it. */
  readonly owner: string | null;
}

/**
 * The most rows one statement reads. Far past any real day's queues; past it a group's count is still whole, but the
 * tasks it leaves unread are missing from the overdue figure, and a look at a board this full says so.
 */
export const READ_CAP = 2000;

/**
 * The visit a task settled on the dispatch board is about, so the task links to it there: a move's visit, found by
 * the move, and a job on leave, which is the task's own row. A move also carries its client's mobile, for the call.
 */
const BOARD_VISIT = `
  LEFT JOIN dispatch_moves m ON t."group" = 'untold_move' AND m.id = t.id
  LEFT JOIN appointments v ON v.id = COALESCE(m.appointment_id,
    CASE WHEN t."group" IN ('leave_conflict', 'move_unanswered', 'unassigned_visit', 'visit_left_open') THEN t.id END)
  LEFT JOIN people caller ON (m.id IS NOT NULL OR t."group" = 'move_unanswered') AND caller.id = v.person_id`;

/**
 * One statement's arms, the tasks `kept` keeps, each with the member of staff ops made it theirs, the longest wait
 * first. A task's owner is found by its group, its row's id and its episode (docs/decisions/0092-task-owners.md), so
 * one left behind by a task since done lands on no new task about the same row.
 */
const withOwners = (arms: string, kept: string) => `SELECT t.*, o.owner,
       v.id AS visit_id, v.window_start AS visit_start, caller.mobile_e164 AS person_mobile
  FROM (${arms}) t
  LEFT JOIN task_owners o ON o.task_group = t."group" AND o.subject_id = t.id AND o.episode = t.episode
  ${BOARD_VISIT}
 WHERE ${kept}
 ORDER BY t.since LIMIT ${String(READ_CAP)}`;

/** How many tasks a queue's arms keep, read only for a queue whose list stopped at READ_CAP. */
const countOf = (arms: string, kept: string) => `SELECT COUNT(*) AS waiting FROM (${arms}) t WHERE ${kept}`;

interface Row {
  group: TaskGroup;
  id: string;
  person_id: string | null;
  person_name: string | null;
  detail: string | null;
  /** The task's facts, as the statement wrote them in JSON (./task-facts.ts). */
  facts: string | null;
  since: string;
  /** The start of the visit a task is about, which it may fall due no later than. */
  due_by: string | null;
  episode: string;
  owner: string | null;
  visit_id: string | null;
  visit_start: string | null;
  person_mobile: string | null;
}

/** The rules a held grant met, of which the board shows the first (src/domain/referrals/referral-grants.ts). */
function firstSignal(signals: string | null): string | null {
  if (signals === null) return null;
  const parsed = JSON.parse(signals) as unknown;
  return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : null;
}

/** A First fit to book's consultation start, then the window its fit is offered in, or "any" where there is none. */
function consultedWithWindow(consultedStart: string, schedule: SlotSchedule): string {
  const window = offeredWindow("first_fit", schedule.at(consultedStart).window);
  return `${consultedStart} ${window ?? "any"}`;
}

/**
 * The one fact a task turns on, as ops read it. A partial visit's is its kind, then the
 * technician's reason in the words ops gave it: the statement reads them from
 * the reasons ops saved, and a reason from the committed list, which stands
 * until they save one, is named here (docs/decisions/0087-consumables-and-stock.md).
 */
function detailOf(row: Row, schedule: SlotSchedule): string | null {
  if (row.group === "referral_review") return firstSignal(row.detail);
  if (row.group === "first_fit_to_book" && row.detail !== null) return consultedWithWindow(row.detail, schedule);
  if (row.group !== "partial_visit" || row.detail === null) return row.detail;
  // The visit's kind, then the reason.
  const [kind = "", ...words] = row.detail.split(" ");
  const reason = words.join(" ");
  return `${kind} ${PARTIAL_REASONS.find((each) => each.id === reason)?.label ?? reason}`;
}

/**
 * An At-risk client's and a First fit to book's days, which their statements leave to the next visit's policy: the day
 * each waits from, counted from the visit or consultation it read, and the day an at-risk client's service fell due.
 */
function nextVisitDays(row: Row, days: NextVisitDays): Row {
  if (row.group === "first_fit_to_book")
    return { ...row, since: firstFitToBookFrom(indiaDate(new Date(row.since)), days) };
  if (row.group !== "at_risk_client") return row;
  const lastVisitDay = indiaDate(new Date(row.since));
  const due = serviceDue(lastVisitDay, days);
  return {
    ...row,
    since: atRiskFrom(lastVisitDay, days),
    detail: `${row.since} ${due}`,
    facts: JSON.stringify({ last_visit_at: row.since, due_on: due }),
  };
}

/** A replacement is due on a calendar date; everything else waits from an instant. */
const instantOf = (since: string) => (since.length === 10 ? indiaInstant(since, "00:00").toISOString() : since);

interface Outstanding {
  /** The longest wait first. */
  readonly tasks: Task[];
  /** How many wait in each group, those past READ_CAP too; a group with none is left out. */
  readonly counts: ReadonlyMap<TaskGroup, number>;
  /** A statement reached READ_CAP, so some task is missing from `tasks`, and from the overdue figure. */
  readonly truncated: boolean;
}

/** Which tasks a look reads, and the figures ops set that they are counted by, the committed ones where left out. */
interface BoardScope {
  /** The next visit's days (src/policy/next-visit.ts), which At-risk client and First fit to book are counted by. */
  readonly days?: NextVisitDays;
  /** Care's hours (src/policy/care-hours.ts), which a chat's reply-by time is counted by. */
  readonly hours?: CareHours;
  /** The days lapsed before a client counts as lost, and leaves At-risk client (src/policy/client-standing.ts). */
  readonly lostAfter?: number;
  /** Where the caller's grants reach for each group; everywhere when left out, as the nightly look reads. */
  readonly reach?: (group: TaskGroup) => PlacesReached;
  /** One client's tasks alone. */
  readonly person?: string;
}

/**
 * A queue's statement, `read` its list or its count, kept to the tasks within reach and, where asked, about the one
 * client.
 */
function statementOf(
  db: D1Database,
  queue: Queue,
  { at, scope, read }: { at: ReadAt; scope: BoardScope; read: (arms: string, kept: string) => string },
): D1PreparedStatement {
  const binds = queue.binds?.(at) ?? [];
  const reach = `?${String(binds.length + 1)}`;
  const person = `?${String(binds.length + 2)}`;
  const kept = `${taskWithinReach(queue.group, "t.id", reach)} AND (${person} IS NULL OR t.person_id = ${person})`;
  const reached = scope.reach?.(queue.group) ?? EVERYWHERE;
  return db.prepare(read(queue.sql, kept)).bind(...binds, reachBinding(reached), scope.person ?? null);
}

/**
 * Each group's count: the tasks read and kept, and those a full list left unread, which a second look counts. A chat
 * left unread is counted though it may still be within its reply-by time.
 */
async function countsOf(
  db: D1Database,
  lists: readonly D1Result<Row>[],
  { kept, at, scope }: { kept: readonly Row[]; at: ReadAt; scope: BoardScope },
): Promise<Map<TaskGroup, number>> {
  const counts = new Map<TaskGroup, number>();
  const add = (group: TaskGroup, more: number) => counts.set(group, (counts.get(group) ?? 0) + more);
  for (const row of kept) add(row.group, 1);
  const full = QUEUES.filter((_, index) => (lists[index]?.results.length ?? 0) >= READ_CAP);
  if (full.length === 0) return counts;
  const totals = await db.batch<{ waiting: number }>(
    full.map((queue) => statementOf(db, queue, { at, scope, read: countOf })),
  );
  full.forEach((queue, index) => add(queue.group, (totals[index]?.results[0]?.waiting ?? 0) - READ_CAP));
  return counts;
}

/** The moments the queues compare with, from India's date today. */
function readAt(now: Date, days: NextVisitDays, lostAfter: number): ReadAt {
  const today = indiaDate(now);
  // The first moment after each last day, as the instants the visits' starts are compared with.
  const after = (day: string) => indiaInstant(addDays(day, 1), "00:00").toISOString();
  const standing = { cadence: days.service_cadence, grace: days.at_risk_after_due, lostAfter };
  return {
    today,
    todayStarts: indiaInstant(today, "00:00").toISOString(),
    now: now.toISOString(),
    days,
    atRiskBefore: after(atRiskIfDoneBy(today, days)),
    notLostFrom: after(lostIfDoneBy(today, standing)),
    toBookBefore: after(firstFitToBookIfConsultedBy(today, days)),
    linksClosedIfSentBy: closedIfSentBy(now).toISOString(),
  };
}

/** What ops still have to do within the scope asked, the longest wait first. */
export async function outstandingTasks(
  db: D1Database,
  now: Date,
  sla: Slas,
  scope: BoardScope = {},
): Promise<Outstanding> {
  const { days = NEXT_VISIT_DAYS, hours = CARE_HOURS, lostAfter = LOST_AFTER_DAYS } = scope;
  const at = readAt(now, days, lostAfter);
  const [answers, schedule] = await Promise.all([
    db.batch<Row>(QUEUES.map((queue) => statementOf(db, queue, { at, scope, read: withOwners }))),
    loadSlotSchedule(db),
  ]);
  const truncated = answers.some((answer) => answer.results.length >= READ_CAP);
  // Each queue sorted its own rows; the board wants one list, so they are merged on the same column.
  const read = answers.flatMap((answer) => answer.results).map((row) => nextVisitDays(row, days));
  const results = overdueChats(read, hours, now).sort((a, b) => a.since.localeCompare(b.since));
  const counts = await countsOf(db, answers, { kept: results, at, scope });
  return { tasks: results.map((row) => taskOf(row, sla, schedule)), counts, truncated };
}

/** The group's allowance from when it started waiting, or the visit it is about, whichever comes first. */
function dueOf(row: Row, since: string, sla: Slas): Date {
  const allowed = dueAt(new Date(since), row.group, sla);
  if (row.due_by === null) return allowed;
  const visit = new Date(row.due_by);
  return visit < allowed ? visit : allowed;
}

function personOf(row: Row): Task["person"] {
  if (row.person_id === null || row.person_name === null) return null;
  return { id: row.person_id, name: row.person_name, mobile: row.person_mobile };
}

function visitOf(row: Row): TaskVisit | null {
  if (row.visit_id === null || row.visit_start === null) return null;
  return { id: row.visit_id, starts_at: row.visit_start };
}

function taskOf(row: Row, sla: Slas, schedule: SlotSchedule): Task {
  const since = instantOf(row.since);
  return {
    id: row.id,
    group: row.group,
    person: personOf(row),
    visit: visitOf(row),
    detail: detailOf(row, schedule),
    facts: factsOf(row, schedule),
    since,
    due: dueOf(row, since, sla).toISOString(),
    episode: row.episode,
    owner: row.owner,
  };
}

/** How many have waited past their day. The console reads the same day, so both agree. */
export const overdueCount = (tasks: readonly Task[], now: Date): number =>
  tasks.filter((task) => indiaDate(new Date(task.due)) < indiaDate(now)).length;
