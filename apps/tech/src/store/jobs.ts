// Today's and tomorrow's jobs and cards, kept on the phone so the app opens in
// a basement with no signal (the technician prompt's "Offline first"). Nothing
// further out is kept: a job the backend has not unlocked has no address and no
// client card to keep.
//
// Two answers of the API's are kept beside them, because no later call gives
// them back: what a check-in measured (the evidence chain's distance and its wait), and
// the instant the technician closed the job out, which the close-out's duration runs
// to. So is the job's start as the card showed it at check-in, which every
// later step is sent with. Each has a store of its own (./db.ts).

import type { CheckIn, Job, JobState, JobSummary } from "../api.ts";
import { dayAfter } from "../lib/when.ts";
import { all, clear, get, put, remove } from "./db.ts";

export async function keepDay(date: string, jobs: readonly JobSummary[]): Promise<void> {
  await put("days", { date, jobs });
}

export async function keptDay(date: string): Promise<readonly JobSummary[] | null> {
  return (await get("days", date))?.jobs ?? null;
}

/**
 * Where a job stands as the API answered a write of its, kept in the day that holds it: the list then says so with no
 * signal, and before it is next read.
 */
export async function keepLanded(jobId: string, state: JobState): Promise<void> {
  for (const day of await all("days")) {
    if (!day.jobs.some((job) => job.id === jobId)) continue;
    await put("days", { ...day, jobs: day.jobs.map((job) => (job.id === jobId ? { ...job, progress: state } : job)) });
  }
}

/** Where each job of the days the phone holds stood when last heard of, by job. */
export async function keptStates(): Promise<Map<string, JobState>> {
  const states = new Map<string, JobState>();
  for (const day of await all("days")) for (const job of day.jobs) states.set(job.id, job.progress);
  return states;
}

export async function keepJob(job: Job): Promise<void> {
  await put("cards", job);
}

export async function keptJob(id: string): Promise<Job | null> {
  return get("cards", id);
}

/** What the check-in measured: the distance, the radius, and when the no-show wait ends. */
export async function keepArrival(jobId: string, arrival: CheckIn): Promise<void> {
  await put("arrivals", { job_id: jobId, arrival });
}

export async function keptArrival(jobId: string): Promise<CheckIn | null> {
  return (await get("arrivals", jobId))?.arrival ?? null;
}

/** When the technician took the outcome, which the close-out's duration runs to. */
export async function keepClosed(jobId: string, at: number = Date.now()): Promise<void> {
  await put("closures", { job_id: jobId, at });
}

export async function keptClosed(jobId: string): Promise<number | null> {
  return (await get("closures", jobId))?.at ?? null;
}

/**
 * The job's start as the card showed it when the technician checked in. Every later step is sent with it, so a move
 * made after they arrived is refused, not taken in by a card read again since.
 */
export async function keepStartAtCheckIn(jobId: string, startsAt: string): Promise<void> {
  await put("starts", { job_id: jobId, starts_at: startsAt });
}

export async function keptStartAtCheckIn(jobId: string): Promise<string | null> {
  return (await get("starts", jobId))?.starts_at ?? null;
}

/** Once the technician lets go of a job's work: a check-in on it again keeps the start the card then has. */
export async function forgetStartAtCheckIn(jobId: string): Promise<void> {
  await remove("starts", jobId);
}

/** A job whose unsent work the technician let go of: its arrival and close-out go too, so only what landed speaks. */
export async function forgetMarks(jobId: string): Promise<void> {
  await remove("arrivals", jobId);
  await remove("closures", jobId);
}

/** Each job whose card the phone holds, by its client's name: what the close-out reads. */
export async function keptNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const card of await all("cards")) if (card.client !== null) names.set(card.id, card.client.name);
  return names;
}

/** What the phone holds of a job whether or not its card is open: when, what and where, and the client once open. */
export interface HeldJob {
  readonly starts_at: string;
  readonly type: JobSummary["type"];
  readonly one_visit: boolean;
  readonly sector: string | null;
  readonly client: string | null;
}

type Listed = Pick<JobSummary, "starts_at" | "type" | "one_visit" | "sector">;

const heldOf = (job: Listed, client: string | null): HeldJob => ({
  starts_at: job.starts_at,
  type: job.type,
  one_visit: job.one_visit,
  sector: job.sector,
  client,
});

/**
 * Each job the phone holds, from its card, else from the day's list it is on. A card read again after ops moved the
 * job carries its new start (apps/tech/src/store/outbox.ts).
 */
export async function keptJobs(): Promise<Map<string, HeldJob>> {
  const jobs = new Map<string, HeldJob>();
  for (const day of await all("days")) for (const job of day.jobs) jobs.set(job.id, heldOf(job, null));
  for (const card of await all("cards")) jobs.set(card.id, heldOf(card, card.client?.name ?? null));
  return jobs;
}

/** The days and the clients' cards, gone; each job's arrival and close-out stay with the work not yet sent. */
export async function dropCards(): Promise<void> {
  await clear("days");
  await clear("cards");
}

/** Everything the phone holds of the jobs, gone. */
export async function dropJobs(): Promise<void> {
  await dropCards();
  for (const name of ["arrivals", "closures", "starts"] as const) await clear(name);
}

/**
 * Lets go of everything but today's and tomorrow's jobs, and any job whose
 * work has not reached us yet. Run each time a day arrives fresh from the API
 * (apps/tech/src/lib/useDay.ts), so a client's card stays on the phone while
 * the job is in those two days, and no longer.
 */
export async function forgetOld(today: string, unsent: ReadonlySet<string>): Promise<void> {
  const days = new Set([today, dayAfter(today)]);
  const jobs = new Set(unsent);
  for (const day of await all("days")) {
    if (days.has(day.date)) for (const job of day.jobs) jobs.add(job.id);
    else await remove("days", day.date);
  }
  for (const card of await all("cards")) if (!jobs.has(card.id)) await remove("cards", card.id);
  for (const name of ["arrivals", "closures", "starts"] as const) {
    for (const mark of await all(name)) if (!jobs.has(mark.job_id)) await remove(name, mark.job_id);
  }
}
