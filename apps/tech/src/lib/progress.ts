// Where a job has got to, read from what the API says has landed and what the
// phone is still holding for it. The API is the authority on order — it refuses
// a step sent before the one ahead of it — so the screens ask the same question
// the same way (docs/api-tech.md, `out_of_order`).
//
// A write the API stopped (superseded or refused) has not happened, so only
// what is still waiting to be sent counts beside what landed.

import type { CheckIn, Job, Step } from "../api.ts";
import type { Queued } from "../store/outbox.ts";
import type { InJobStep } from "../route.ts";
import { STEP_PATHS } from "../route.ts";

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

export const started = (job: Job, queued: readonly Queued[]): boolean => done(job, queued).has("start");
export const checkedIn = (job: Job, queued: readonly Queued[]): boolean => done(job, queued).has("check_in");

export type Outcome = "done" | "partial" | "no_show";

const OUTCOMES: ReadonlySet<string> = new Set<Outcome>(["done", "partial", "no_show"]);
const isOutcome = (value: unknown): value is Outcome => typeof value === "string" && OUTCOMES.has(value);

/** How the job closed: the outcome that landed, else one still on its way from the phone. */
export function outcomeOf(job: Job, queued: readonly Queued[]): Outcome | null {
  if (isOutcome(job.progress.outcome)) return job.progress.outcome;
  for (const event of queued) {
    if (event.job_id !== job.id || event.state !== "waiting") continue;
    if (event.kind === "no_show") return "no_show";
    const chosen = event.kind === "outcome" ? (event.body as { outcome?: unknown } | null)?.outcome : null;
    if (isOutcome(chosen)) return chosen;
  }
  return null;
}

export const closed = (job: Job, queued: readonly Queued[]): boolean => outcomeOf(job, queued) !== null;

/** Whether ops changed this job under the phone: a write of its came back superseded. */
export const changedUnder = (jobId: string, queued: readonly Queued[]): boolean =>
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
 *   door        board B5: arrive, wait, and start or close as a no-show
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

export interface Wait {
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
