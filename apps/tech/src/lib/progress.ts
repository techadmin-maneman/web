// Where a job has got to, read from what the API says has landed and what the
// phone is still holding for it. The API is the authority on order — it refuses
// a step sent before the one ahead of it — so the screens ask the same question
// the same way (docs/api-tech.md, `out_of_order`).

import type { Job, Step } from "../api.ts";
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
export const closed = (job: Job, queued: readonly Queued[]): boolean =>
  job.progress.outcome !== null || done(job, queued).has("outcome") || done(job, queued).has("no_show");
