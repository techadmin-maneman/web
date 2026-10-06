// Where a job has got to, read from what the API says has landed and what the
// phone is still holding for it. The API is the authority on order — it refuses
// a step sent before the one ahead of it — so the screens ask the same question
// the same way (docs/api-tech.md, `out_of_order`).
//
// A write the API stopped (superseded or refused) has not happened, so only
// what is still waiting to be sent counts beside what landed.

import type { CheckIn, Job, JobState, JobSummary, Step } from "../api.ts";
import type { Queued } from "../store/outbox.ts";
import type { InJobStep } from "../route.ts";
import { STEP_PATHS } from "../route.ts";

/** What the day's list and the card both carry of a job: enough to say whether it began and how it closed. */
type Tracked = Pick<JobSummary, "id" | "progress">;

const IN_JOB = new Set<string>(Object.keys(STEP_PATHS));

const isInJob = (step: Step): step is InJobStep => IN_JOB.has(step);

/** The steps this visit runs, in order: the API leaves the piece out where it does not apply. */
export const stepsOf = (job: Job): InJobStep[] => job.steps.filter(isInJob);

/** Everything this job has sent, whether it reached us or is still on the phone. */
export function done(job: Job, queued: readonly Queued[]): ReadonlySet<string> {
  const sent = new Set<string>(job.progress.steps_done);
  if (job.progress.checked_in_at !== null) sent.add("check_in");
  if (job.progress.started_at !== null) sent.add("start");
  for (const event of queued) {
    if (event.job_id === job.id && event.state === "waiting") sent.add(event.kind);
  }
  return sent;
}

/** The step the technician is on, or null when every one of them is in. */
export function nextStep(job: Job, queued: readonly Queued[]): InJobStep | null {
  const sent = done(job, queued);
  return stepsOf(job).find((step) => !sent.has(step)) ?? null;
}

const started = (job: Tracked, queued: readonly Queued[]): boolean =>
  job.progress.started_at !== null ||
  queued.some((event) => event.job_id === job.id && event.kind === "start" && event.state === "waiting");
export const checkedIn = (job: Job, queued: readonly Queued[]): boolean => done(job, queued).has("check_in");

export type Outcome = "done" | "partial" | "no_show";

const OUTCOMES: ReadonlySet<string> = new Set<Outcome>(["done", "partial", "no_show"]);
const isOutcome = (value: unknown): value is Outcome => typeof value === "string" && OUTCOMES.has(value);

/** How the job closed: the outcome that landed, else one still on its way from the phone. */
export function outcomeOf(job: Tracked, queued: readonly Queued[]): Outcome | null {
  if (isOutcome(job.progress.outcome)) return job.progress.outcome;
  for (const event of queued) {
    if (event.job_id !== job.id || event.state !== "waiting") continue;
    if (event.kind === "no_show") return "no_show";
    const chosen = event.kind === "outcome" ? (event.body as { outcome?: unknown } | null)?.outcome : null;
    if (isOutcome(chosen)) return chosen;
  }
  return null;
}

export const closed = (job: Tracked, queued: readonly Queued[]): boolean => outcomeOf(job, queued) !== null;

/** What a one visit's client decided at the piece step: the product's tier, or that they decided against the fit. */
export type ClientChoice = NonNullable<Job["client_choice"]>;

/** The choice a piece step's body records; null for one that records neither. */
function choiceIn(body: unknown): ClientChoice | null {
  const sent = body as { declined?: unknown; product?: unknown } | null;
  if (sent?.declined === true) return { declined: true };
  return typeof sent?.product === "string" ? { product: sent.product } : null;
}

/** A one visit's choice: the piece step still on the phone, else the one that reached us; null before either. */
export function choiceOf(job: Job, queued: readonly Queued[]): ClientChoice | null {
  const held = queued
    .filter((event) => event.job_id === job.id && event.kind === "piece" && event.state !== "superseded")
    .at(-1);
  const heldChoice = held === undefined ? null : choiceIn(held.body);
  return heldChoice ?? job.client_choice;
}

/** Whether a one visit's client decided against the fit, so nothing is fitted and nothing is paid. */
export const declinedTheFit = (job: Job, queued: readonly Queued[]): boolean => {
  if (!job.one_visit) return false;
  const choice = choiceOf(job, queued);
  return choice !== null && "declined" in choice;
};

/** Where a row of the day's list stands once its job has begun. */
export type RowState = "closed" | "in_progress";

/**
 * Where a row of the day's list stands, read as its card reads it: the phone's writes still on their way, then what
 * landed, then the visit's status. What landed is the list's word, or a write's answer `heard` since, whichever knows
 * more.
 */
export function rowState(job: JobSummary, queued: readonly Queued[], heard: JobState | undefined): RowState | null {
  const landed = {
    started_at: job.progress.started_at ?? heard?.started_at ?? null,
    outcome: job.progress.outcome ?? heard?.outcome ?? null,
  };
  const known = { id: job.id, progress: landed };
  if (closed(known, queued) || job.status === "completed" || job.status === "terminated") return "closed";
  if (started(known, queued) || job.status === "in_progress") return "in_progress";
  return null;
}

/** Whether ops changed this job under the phone: a write of its came back superseded. */
const changedUnder = (jobId: string, queued: readonly Queued[]): boolean =>
  queued.some((event) => event.job_id === jobId && event.state === "superseded");

/**
 * Where a job's card is, which decides what it offers: at most one gold action,
 * and never one the API would refuse.
 *
 *   locked      further out than the day before: time, type and sector only
 *   changed     ops moved it under the phone: what changed, and nothing to press on with
 *   closed      an outcome, landed or on its way
 *   started     the next step, and nothing of the door's
 *   not_today   tomorrow's, unlocked: the card, and no check-in until the day
 *   door        the evidence chain: arrive, wait, and start or close as a no-show
 */
export type Stage = "locked" | "changed" | "closed" | "started" | "not_today" | "door";

export function stageOf(job: Job, queued: readonly Queued[], today: string): Stage {
  if (!job.unlocked) return "locked";
  if (changedUnder(job.id, queued)) return "changed";
  if (closed(job, queued)) return "closed";
  if (started(job, queued)) return "started";
  if (job.date !== today) return "not_today";
  return "door";
}

interface Wait {
  /** When the no-show wait ends, in milliseconds; null before any check-in. */
  readonly endsAt: number | null;
  /**
   * Whether the API holds the check-in. Only then may the job close as a
   * no-show: the wait runs on the API's clock as well as the phone's, from
   * when the check-in reached it (ADR 0065).
   */
  readonly confirmed: boolean;
}

/**
 * The no-show wait: the end the check-in's answer gave, else the one the card
 * carries (a phone that lost its copy still knows), else, for a check-in still
 * on the phone, the wait counted from the tap, or from the booked start for a
 * tap before it.
 */
export function theWait(job: Job, queued: readonly Queued[], arrival: CheckIn | null): Wait {
  const answered = arrival?.passed === true ? arrival.wait_ends_at : null;
  const held = answered ?? job.progress.wait_ends_at;
  if (held !== null) return { endsAt: Date.parse(held), confirmed: true };

  const tapped = queued.find(
    (event) => event.job_id === job.id && event.kind === "check_in" && event.state === "waiting",
  );
  if (tapped === undefined) return { endsAt: null, confirmed: false };
  const startsAt = Math.max(tapped.queued_at, Date.parse(job.starts_at));
  return { endsAt: startsAt + job.no_show_wait_min * 60_000, confirmed: false };
}
