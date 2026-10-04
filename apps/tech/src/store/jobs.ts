// Today's and tomorrow's jobs and cards, kept on the phone so the app opens in
// a basement with no signal (the technician prompt's "Offline first"). Nothing
// further out is kept: a job the backend has not unlocked has no address and no
// client card to keep.
//
// Two answers of the API's are kept beside them, because no later call gives
// them back: what a check-in measured (board B5's distance and its wait), and
// the instant the technician closed the job out, which board B4's duration runs
// to. So is the job's start as the card showed it at check-in, which every
// later step is sent with.

import type { CheckIn, Job, JobState, JobSummary } from "../api.ts";
import { dayAfter } from "../lib/when.ts";
import { all, get, put, remove } from "./db.ts";

type Kept =
  | { readonly id: string; readonly kind: "day"; readonly date: string; readonly jobs: readonly JobSummary[] }
  | { readonly id: string; readonly kind: "job"; readonly job: Job }
  | { readonly id: string; readonly kind: "arrival"; readonly job_id: string; readonly arrival: CheckIn }
  | { readonly id: string; readonly kind: "closed"; readonly job_id: string; readonly at: number }
  | { readonly id: string; readonly kind: "start_at_check_in"; readonly job_id: string; readonly starts_at: string };

const dayKey = (date: string) => `day:${date}`;
const arrivalKey = (jobId: string) => `arrival:${jobId}`;
const closedKey = (jobId: string) => `closed:${jobId}`;
const startAtCheckInKey = (jobId: string) => `start_at_check_in:${jobId}`;

export async function keepDay(date: string, jobs: readonly JobSummary[]): Promise<void> {
  await put("jobs", { id: dayKey(date), kind: "day", date, jobs } satisfies Kept);
}

export async function keptDay(date: string): Promise<readonly JobSummary[] | null> {
  const kept = await get<Kept>("jobs", dayKey(date));
  return kept !== null && kept.kind === "day" ? kept.jobs.map(rowInTodaysShape) : null;
}

const NOTHING_LANDED: JobState = { started_at: null, outcome: null };

/** A row an earlier build kept, before the day's list said where each job stood: begun and closed on neither. */
function rowInTodaysShape(job: JobSummary): JobSummary {
  const kept = job as Omit<JobSummary, "progress"> & { readonly progress?: JobState };
  return { ...kept, progress: kept.progress ?? NOTHING_LANDED };
}

/**
 * Where a job stands as the API answered a write of its, kept in the day that holds it: the list then says so with no
 * signal, and before it is next read.
 */
export async function keepLanded(jobId: string, state: JobState): Promise<void> {
  for (const kept of await all<Kept>("jobs")) {
    if (kept.kind !== "day" || !kept.jobs.some((job) => job.id === jobId)) continue;
    const jobs = kept.jobs.map((job) => (job.id === jobId ? { ...job, progress: state } : job));
    await put("jobs", { ...kept, jobs } satisfies Kept);
  }
}

/** Where each job of the days the phone holds stood when last heard of, by job. */
export async function keptStates(): Promise<Map<string, JobState>> {
  const states = new Map<string, JobState>();
  for (const kept of await all<Kept>("jobs")) {
    if (kept.kind !== "day") continue;
    for (const job of kept.jobs) states.set(job.id, rowInTodaysShape(job).progress);
  }
  return states;
}

export async function keepJob(job: Job): Promise<void> {
  await put("jobs", { id: job.id, kind: "job", job } satisfies Kept);
}

export async function keptJob(id: string): Promise<Job | null> {
  const kept = await get<Kept>("jobs", id);
  return kept !== null && kept.kind === "job" ? inTodaysShape(kept.job) : null;
}

/**
 * A card an earlier build kept, before the job sheet and the consumables were
 * set in the console (docs/decisions/0087-consumables-and-stock.md): its
 * partial reasons were ids alone, and it carried no consumables. It is read in
 * today's shape, so a job opened with no signal after an update still closes:
 * each reason worded from its id, and the step with nothing to start from. One
 * kept before the hair profile carries none, and lists no step for it
 * (docs/decisions/0106-a-clients-hair-profile.md). One kept before a one
 * visit's discount code was on the card carries none, and the outcome step asks.
 */
function inTodaysShape(job: Job): Job {
  const kept = job as Omit<Job, "partial_reasons" | "consumables" | "profile" | "discount_code"> & {
    readonly partial_reasons: readonly (Job["partial_reasons"][number] | string)[];
    readonly consumables?: Job["consumables"];
    readonly profile?: Job["profile"];
    readonly discount_code?: Job["discount_code"];
  };
  return {
    ...kept,
    partial_reasons: kept.partial_reasons.map((reason) =>
      typeof reason === "string" ? { id: reason, label: worded(reason) } : reason,
    ),
    consumables: kept.consumables ?? [],
    profile: kept.profile ?? null,
    discount_code: kept.discount_code ?? null,
  };
}

/** "piece_not_ready" as "Piece not ready". */
const worded = (id: string): string => {
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

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

/**
 * The job's start as the card showed it when the technician checked in. Every later step is sent with it, so a move
 * made after he arrived is refused, not taken in by a card read again since.
 */
export async function keepStartAtCheckIn(jobId: string, startsAt: string): Promise<void> {
  await put("jobs", {
    id: startAtCheckInKey(jobId),
    kind: "start_at_check_in",
    job_id: jobId,
    starts_at: startsAt,
  } satisfies Kept);
}

export async function keptStartAtCheckIn(jobId: string): Promise<string | null> {
  const kept = await get<Kept>("jobs", startAtCheckInKey(jobId));
  return kept !== null && kept.kind === "start_at_check_in" ? kept.starts_at : null;
}

/** Once the technician lets go of a job's work: a check-in on it again keeps the start the card then has. */
export async function forgetStartAtCheckIn(jobId: string): Promise<void> {
  await remove("jobs", startAtCheckInKey(jobId));
}

/** A job whose unsent work the technician let go of: its arrival and close-out go too, so only what landed speaks. */
export async function forgetMarks(jobId: string): Promise<void> {
  await remove("jobs", arrivalKey(jobId));
  await remove("jobs", closedKey(jobId));
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

/** The days and the clients' cards, gone; each job's arrival and close-out stay with the work not yet sent. */
export async function dropCards(): Promise<void> {
  for (const kept of await all<Kept>("jobs")) {
    if (kept.kind === "day" || kept.kind === "job") await remove("jobs", kept.id);
  }
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
    case "start_at_check_in":
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
