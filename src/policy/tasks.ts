// The ops console's task queue (docs/prompts/phase2-backend.md, "Endpoints" and
// "Pieces tab"). The rules as the prompt states them, the groups they turn on,
// and how long a task may wait.
//
// There is no `tasks` table and there is not going to be one. Every group below
// is a queue the database already keeps: a consultation asked for, a held grant,
// an undecided no-show, a number change waiting for ops, an erasure asked for, a
// piece past its replacement date, an invoice still a draft, an erasure FSM
// would not finish. A task is those rows read at the moment ops
// look, so it cannot go stale, be closed twice or be left open by mistake.
// Closing a task means doing the thing: the row leaves the queue on its own.
//
// The board draws four groups (Replacement order, At-risk client, Referral
// review, Photo QA). Two of them have no record behind them, and four queues
// the board does not draw do; what is built and what is not is item 58 of
// docs/open-points.md.
//
// The last two groups are ours, not the prompt's (docs/decisions/0067-alerts-and-silent-failures.md):
// a finished visit whose invoice is still a draft in Books, which the client
// cannot open until somebody sends it; and an erased client whose FSM contact
// the sweeper could not anonymise, which somebody must do by hand.
//
// So is the first (docs/decisions/0069-dispatch-under-concurrency.md): a visit
// ops moved to another day or window whose client has not heard of it, having
// not agreed to WhatsApp about his visits, or the message having never gone.
// Ops call him, and say so on the dispatch board.

export const RULES = [
  "The replacement due date follows the per-base cycle config already defined in this prompt.",
  "Referral review queue: approve or reject, with the reason recorded.",
  "GET /no-shows and POST /no-shows/:id/decision, for ops to charge or waive from the evidence.",
  "number-change confirmations and deletion-request processing",
] as const;

/** The queues a task is read from, in the order the console lists them. */
export const TASK_GROUPS = [
  "untold_move",
  "consultation_request",
  "replacement_order",
  "referral_review",
  "no_show_decision",
  "number_change",
  "erasure_request",
  "draft_invoice",
  "erasure_unfinished",
] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/**
 * How long a task may wait before it is overdue. The board writes "2 days",
 * "1 day", "Today" and "Overdue 3" and names no group's own allowance, and the
 * prompt states none, so every group waits the same two days, but a client
 * not told of a move, who waits four hours: placeholders until the owner rules
 * each one (docs/open-points.md, item 58).
 */
export type Slas = Readonly<Record<TaskGroup, number>>;

export const TASK_SLA_HOURS: Slas = {
  // A client who does not know his visit moved will not be home for it: a call the same day.
  untold_move: 4,
  consultation_request: 48,
  replacement_order: 48,
  referral_review: 48,
  no_show_decision: 48,
  number_change: 48,
  erasure_request: 48,
  draft_invoice: 48,
  erasure_unfinished: 48,
};

/**
 * When a task that started waiting at `since` falls due. The allowances ops
 * have set, or the ones above: they are ops-editable inputs
 * (docs/decisions/0061-ops-editable-inputs.md).
 */
export const dueAt = (since: Date, group: TaskGroup, sla: Slas = TASK_SLA_HOURS): Date =>
  new Date(since.getTime() + sla[group] * 3_600_000);
