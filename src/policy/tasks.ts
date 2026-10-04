// The ops console's task queue (docs/prompts/phase2-backend.md, "Endpoints" and
// "Pieces tab"). The rules as the prompt states them, the groups they turn on,
// and how long a task may wait.
//
// There is no `tasks` table and there is not going to be one. Every group below
// is a queue the database already keeps: a consultation asked for, a held grant,
// an undecided no-show, a number change waiting for ops, an erasure asked for, a
// grievance not yet answered, a piece past its replacement date, an invoice
// still a draft. A task is those rows read at
// the moment ops look, so it cannot go stale, be closed twice or be left open
// by mistake. Closing a task means doing the thing: the row leaves the queue on
// its own.
//
// The board draws four groups (Replacement order, At-risk client, Referral
// review, Photo QA). Photo QA has no record behind it and is not built, as the
// owner ruled; queues the board does not draw do have one. What is built and
// what is not is open point 61 of docs/open-points.md.
//
// A draft invoice is ours, not the prompt's (docs/decisions/0067-alerts-and-silent-failures.md):
// a finished visit whose invoice is still a draft in Books, which the client
// cannot open until somebody sends it, including one held back because it does
// not total what the visit was sold for, or a credit paid for the visit
// (docs/decisions/0070-vendor-correctness.md).
//
// So is the first (docs/decisions/0069-dispatch-under-concurrency.md): a visit
// ops moved to another day or window whose client has not heard of it, having
// not agreed to WhatsApp about his visits, or the message having never gone.
// Ops call him, and say so on the dispatch board.
//
// And so is a grievance (docs/decisions/0072-ops-clients-and-queues.md): the
// client has been promised an answer within a time, as with an erasure, so it
// is counted down on this board as the other requests about their data are.

//
// So is a job still booked on a day its technician is away (OPS-07): leave
// recorded after a job was assigned moves nothing (ADR 0062), so it waits for
// ops until they move it or take the leave back.
//
// So is a visit to come whose client has given no address
// (docs/decisions/0074-hand-offs-and-messages.md): a booking from the site asks
// for none, and the app tells the client "We confirm it with you before your
// visit". Ops confirm it; the task goes when the client's address is saved, and
// it falls due by the visit at the latest.
//
// So is a consultation and fit in one visit whose client was fitted and has not paid the link closing it sent
// them, or that could not be sent (docs/decisions/0105-a-consultation-and-fit-in-one-visit.md): the owner ruled
// that it is paid for at the visit, so one unpaid after it is owed, and ops follow it up.
//
// A visit left partly done is the prompt's own (BIZ-21): "Partial reasons. …
// ops need the full set because these drive the task queue." It waits with the
// technician's reason until the client has another visit booked after it to
// finish what was left. A no-show is its own outcome, and its own group.
//
// At-risk client is the board's own group, built as the owner ruled on 27
// September 2026 (docs/decisions/0086-the-next-visit-is-offered.md): a fitted
// client with nothing booked, days past the day their next service fell due
// (src/policy/next-visit.ts). First fit to book is ours: a first fit asked for
// on the site's form, still not booked days after the consultation. Both go as
// soon as a later visit is booked, as a visit left partly done does.
//
// Two things about a task are kept, both as the owner ruled on 27 September
// 2026 (docs/decisions/0092-task-owners.md): whose it is, a member of staff ops
// name by their Access e-mail; and, for a visit left partly done alone, that ops
// closed it without a follow-up, with why. Neither is a copy of the task.

import { HOUR_MS } from "../lib/durations.ts";
import { DELETION_DECIDED_WITHIN_DAYS } from "./account-deletion.ts";

export const RULES = [
  "The replacement due date follows the per-base cycle config already defined in this prompt.",
  "GET /no-shows and POST /no-shows/:id/decision, for ops to charge or waive from the evidence.",
  "number-change confirmations and deletion-request processing",
  "Partial reasons. Four in the design. The design says ops need the full set because these drive the task queue.",
  "ops take or assign a task to a named member of staff (their Access e-mail) and the board shows whose it is",
  "ops may close a partial visit's task without a follow-up, with a required reason kept under who closed it",
] as const;

/** The queues a task is read from, in the order the console lists them. */
export const TASK_GROUPS = [
  "untold_move",
  "leave_conflict",
  "address_to_confirm",
  "consultation_request",
  "first_fit_to_book",
  "replacement_order",
  "at_risk_client",
  "partial_visit",
  "referral_review",
  "no_show_decision",
  "number_change",
  "erasure_request",
  "grievance",
  "draft_invoice",
  "payment_owed",
] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/**
 * How long a task may wait before it is overdue, and the one deadline its own
 * queue counts down to as well. The board writes "2 days", "1 day", "Today"
 * and "Overdue 3" and names no group's own allowance, and the prompt states
 * none, so every group waits the same two days, with three exceptions:
 * placeholders until the owner rules each one (docs/open-points.md, item 61).
 */
export type Slas = Readonly<Record<TaskGroup, number>>;

export const TASK_SLA_HOURS: Slas = {
  // A client who does not know his visit moved will not be home for it: a call the same day.
  untold_move: 4,
  // These two are never later than the visit itself (src/domain/tasks.ts).
  leave_conflict: 48,
  address_to_confirm: 48,
  consultation_request: 48,
  first_fit_to_book: 48,
  replacement_order: 48,
  at_risk_client: 48,
  partial_visit: 48,
  referral_review: 48,
  no_show_decision: 48,
  number_change: 48,
  // What the client was promised: the 7 days run from the request to ops' decision (ADR 0049).
  erasure_request: DELETION_DECIDED_WITHIN_DAYS * 24,
  // The app promises an answer within 30 days at the latest (docs/open-points.md, item 51).
  grievance: 30 * 24,
  draft_invoice: 48,
  payment_owed: 48,
};

/**
 * When a task that started waiting at `since` falls due. The allowances ops
 * have set, or the ones above: they are ops-editable inputs
 * (docs/decisions/0061-ops-editable-inputs.md).
 */
export const dueAt = (since: Date, group: TaskGroup, sla: Slas = TASK_SLA_HOURS): Date =>
  new Date(since.getTime() + sla[group] * HOUR_MS);

/**
 * The groups ops may close without doing the thing, with a reason: a visit left partly done, whose follow-up the
 * client may never want. Every other group leaves the board only when its thing is done.
 */
export const CLOSABLE_TASK_GROUPS = ["partial_visit"] as const satisfies readonly TaskGroup[];

export const isClosable = (group: TaskGroup): boolean => (CLOSABLE_TASK_GROUPS as readonly TaskGroup[]).includes(group);

/**
 * How lately a member of staff must have used the console to be given a task. There is no staff table, and one who
 * has left stays in the audit log for ever; this bounds the list to the people still at work. Ours, not the owner's
 * (docs/decisions/0092-task-owners.md).
 */
export const STAFF_SEEN_WITHIN_DAYS = 90;

/**
 * Who may own a task: a member of staff, named by the e-mail Access signs them in with, who has used the console in
 * the last STAFF_SEEN_WITHIN_DAYS (src/domain/task-owners.ts). A typo, a service token's ID or someone long gone
 * would make the task nobody's.
 */
export const mayOwnTasks = (email: string, staff: readonly string[]): boolean => staff.includes(email.toLowerCase());
