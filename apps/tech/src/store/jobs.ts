// Today's and tomorrow's jobs and cards, kept on the phone so the app opens in
// a basement with no signal (the technician prompt's "Offline first"). Nothing
// further out is kept: a job the backend has not unlocked has no address and no
// client card to keep.

import type { Job, JobSummary } from "../api.ts";
import { all, get, put } from "./db.ts";

type Record =
  | { readonly id: string; readonly kind: "day"; readonly date: string; readonly jobs: readonly JobSummary[] }
  | { readonly id: string; readonly kind: "job"; readonly job: Job };

const dayKey = (date: string) => `day:${date}`;

export async function keepDay(date: string, jobs: readonly JobSummary[]): Promise<void> {
  await put("jobs", { id: dayKey(date), kind: "day", date, jobs } satisfies Record);
}

export async function keptDay(date: string): Promise<readonly JobSummary[] | null> {
  const kept = await get<Record>("jobs", dayKey(date));
  return kept !== null && kept.kind === "day" ? kept.jobs : null;
}

export async function keepJob(job: Job): Promise<void> {
  await put("jobs", { id: job.id, kind: "job", job } satisfies Record);
}

export async function keptJob(id: string): Promise<Job | null> {
  const kept = await get<Record>("jobs", id);
  return kept !== null && kept.kind === "job" ? kept.job : null;
}

/** Every day the phone holds, for the screens that say what it is working from. */
export async function keptDays(): Promise<string[]> {
  return (await all<Record>("jobs")).filter((kept) => kept.kind === "day").map((kept) => kept.date);
}

/**
 * Each job the phone knows of, by its client's name, so the waiting screen can
 * say whose photographs and whose actions are still here.
 */
export async function keptNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const kept of await all<Record>("jobs")) {
    if (kept.kind === "day") for (const job of kept.jobs) names.set(job.id, job.client_name);
    else names.set(kept.job.id, kept.job.client_name);
  }
  return names;
}
