// Today's and tomorrow's jobs and cards, kept on the phone so the app opens in
// a basement with no signal (the technician prompt's "Offline first"). Nothing
// further out is kept: a job the backend has not unlocked has no address and no
// client card to keep.
//
// Two answers of the API's are kept beside them, because no later call gives
// them back: what a check-in measured (board B5's distance and its wait), and
// the instant the technician closed the job out, which board B4's duration runs
// to.

import type { CheckIn, Job, JobSummary } from "../api.ts";
import { dayAfter } from "../lib/when.ts";
import { all, get, put, remove } from "./db.ts";

type Kept =
  | { readonly id: string; readonly kind: "day"; readonly date: string; readonly jobs: readonly JobSummary[] }
  | { readonly id: string; readonly kind: "job"; readonly job: Job }
  | { readonly id: string; readonly kind: "arrival"; readonly job_id: string; readonly arrival: CheckIn }
  | { readonly id: string; readonly kind: "closed"; readonly job_id: string; readonly at: number };

const dayKey = (date: string) => `day:${date}`;
const arrivalKey = (jobId: string) => `arrival:${jobId}`;
const closedKey = (jobId: string) => `closed:${jobId}`;

export async function keepDay(date: string, jobs: readonly JobSummary[]): Promise<void> {
  await put("jobs", { id: dayKey(date), kind: "day", date, jobs } satisfies Kept);
}

export async function keptDay(date: string): Promise<readonly JobSummary[] | null> {
  const kept = await get<Kept>("jobs", dayKey(date));
  return kept !== null && kept.kind === "day" ? kept.jobs : null;
}

export async function keepJob(job: Job): Promise<void> {
  await put("jobs", { id: job.id, kind: "job", job } satisfies Kept);
}

export async function keptJob(id: string): Promise<Job | null> {
  const kept = await get<Kept>("jobs", id);
  return kept !== null && kept.kind === "job" ? kept.job : null;
}

/** What the check-in measured: the distance, the radius, and when the no-show wait ends. */
export async function keepArrival(jobId: string, arrival: CheckIn): Promise<void> {
  await put("jobs", { id: arrivalKey(jobId), kind: "arrival", job_id: jobId, arrival } satisfies Kept);
}

export async function keptArrival(jobId: string): Promise<CheckIn | null> {
  const kept = await get<Kept>("jobs", arrivalKey(jobId));
  return kept !== null && kept.kind === "arrival" ? kept.arrival : null;
}

/** When the technician took the outcome, which the close-out's duration runs to. */
export async function keepClosed(jobId: string, at: number = Date.now()): Promise<void> {
  await put("jobs", { id: closedKey(jobId), kind: "closed", job_id: jobId, at } satisfies Kept);
}

export async function keptClosed(jobId: string): Promise<number | null> {
  const kept = await get<Kept>("jobs", closedKey(jobId));
  return kept !== null && kept.kind === "closed" ? kept.at : null;
}

/** Every day the phone holds, for the screens that say what it is working from. */
export async function keptDays(): Promise<string[]> {
  return (await all<Kept>("jobs")).filter((kept) => kept.kind === "day").map((kept) => kept.date);
}

/**
 * Each job whose card the phone holds, by its client's name. The day's list
 * carries no name — the API gives a client only with the card, the day before
 * the visit — so a row, the waiting screen and the close-out all read it here.
 */
export async function keptNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const kept of await all<Kept>("jobs")) {
    if (kept.kind === "job" && kept.job.client !== null) names.set(kept.job.id, kept.job.client.name);
  }
  return names;
}

/** Whether a kept record is still needed: its day is today or tomorrow, or its job is one the phone still needs. */
function stillNeeded(kept: Kept, days: ReadonlySet<string>, jobs: ReadonlySet<string>): boolean {
  switch (kept.kind) {
    case "day":
      return days.has(kept.date);
    case "job":
      return jobs.has(kept.id);
    case "arrival":
    case "closed":
      return jobs.has(kept.job_id);
  }
}

/**
 * Lets go of everything but today's and tomorrow's jobs, and any job whose
 * work has not reached us yet. Run each time a day arrives fresh from the API
 * (apps/tech/src/lib/useDay.ts), so a client's card stays on the phone while
 * the job is in those two days, and no longer.
 */
export async function forgetOld(today: string, unsent: ReadonlySet<string>): Promise<void> {
  const kept = await all<Kept>("jobs");
  const days = new Set([today, dayAfter(today)]);
  const jobs = new Set(unsent);
  for (const record of kept) {
    if (record.kind === "day" && days.has(record.date)) for (const job of record.jobs) jobs.add(job.id);
  }
  for (const record of kept) {
    if (!stillNeeded(record, days, jobs)) await remove("jobs", record.id);
  }
}
