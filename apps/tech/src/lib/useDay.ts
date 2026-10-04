// One day's jobs: from the API when there is signal, from the phone when there
// is none. The list the API answers is kept, so the next basement opens on it,
// and whatever the phone no longer needs is let go of at the same moment.
//
// The phone's copy stands in only when the API cannot be reached. Any other
// answer is the API's word: a 401 ends the session, and App wipes the phone
// (apps/tech/src/App.tsx); a 404 says the job is not this technician's. Showing
// what the phone kept after either would show what the API has just refused.

import { useAsync, valueOr } from "@maneman/ui/useAsync";
import { useCallback, useMemo } from "react";
import { api, unreachable, type Job, type JobSummary } from "../api.ts";
import { forgetOld, keepDay, keepJob, keptDay, keptJob, keptJobs, keptNames, type HeldJob } from "../store/jobs.ts";
import { unsentJobs } from "../store/outbox.ts";
import { todayInIndia } from "./when.ts";

interface Failed {
  readonly state: "failed";
  /** The API's ID for the call that failed, for the technician to quote; null when nothing answered. */
  readonly requestId: string | null;
}

export type Loaded<T> =
  | { readonly state: "loading" }
  | Failed
  /** `fromPhone` is true when this is what the phone kept, not what the API just said. */
  | { readonly state: "loaded"; readonly value: T; readonly fromPhone: boolean };

const failed = (requestId: string | null): Failed => ({ state: "failed", requestId });

/** Lets go of whatever the phone no longer needs, now that a fresh day says what that is. */
async function forgetStale(): Promise<void> {
  await forgetOld(todayInIndia(), await unsentJobs());
}

// In both loads, keeping is for the next basement: a phone with no room to keep
// an answer (App says so) still shows it now, so a failed keep is let pass.

export async function loadDay(date: string): Promise<Loaded<readonly JobSummary[]>> {
  const answer = await api.jobs(date);
  if (answer.ok) {
    await keepDay(date, answer.body.jobs).catch(() => undefined);
    await forgetStale().catch(() => undefined);
    return { state: "loaded", value: answer.body.jobs, fromPhone: false };
  }
  if (!unreachable(answer)) return failed(answer.requestId);
  const kept = await keptDay(date).catch(() => null);
  return kept === null ? failed(answer.requestId) : { state: "loaded", value: kept, fromPhone: true };
}

export async function loadJob(id: string): Promise<Loaded<Job>> {
  const answer = await api.job(id);
  if (answer.ok) {
    await keepJob(answer.body).catch(() => undefined);
    return { state: "loaded", value: answer.body, fromPhone: false };
  }
  if (!unreachable(answer)) return failed(answer.requestId);
  const kept = await keptJob(id).catch(() => null);
  return kept === null ? failed(answer.requestId) : { state: "loaded", value: kept, fromPhone: true };
}

/** A load that throws, as a store that would not open can, fails as one nothing answered. */
function useKept<T>(load: () => Promise<Loaded<T>>, watch: unknown = null): readonly [Loaded<T>, () => void] {
  const [settled, retry] = useAsync(load, watch);
  const loaded = useMemo((): Loaded<T> => {
    if (settled.state === "pending") return { state: "loading" };
    return settled.state === "failed" ? failed(null) : settled.value;
  }, [settled]);
  return [loaded, retry];
}

export function useDay(date: string): readonly [Loaded<readonly JobSummary[]>, () => void] {
  const load = useCallback(() => loadDay(date), [date]);
  return useKept(load);
}

/**
 * Once the day's list has arrived, each card it names is fetched and kept, so
 * the phone opens them in a basement: "today's and tomorrow's jobs and client
 * cards are cached" (docs/prompts/phase2-frontend.md). The cards are fetched
 * side by side, not one after another. A locked job has no card to keep, and a
 * card that cannot be fetched or kept is let go: there is no signal, or no room.
 */
export async function keepCards(jobs: readonly JobSummary[]): Promise<void> {
  const unlocked = jobs.filter((job) => job.unlocked);
  await Promise.all(unlocked.map((job) => keepCard(job.id)));
}

async function keepCard(id: string): Promise<void> {
  const answer = await api.job(id);
  if (!answer.ok) return;
  await keepJob(answer.body).catch(() => undefined);
}

/**
 * One job's card. `watch` re-reads it: a write that lands changes what the job
 * has done, and the card is where the screens read that from, so the outbox's
 * own signature is passed in (apps/tech/src/lib/useOutbox.ts).
 */
export function useJob(id: string, watch: unknown = null): readonly [Loaded<Job>, () => void] {
  const load = useCallback(() => loadJob(id), [id]);
  return useKept(load, watch);
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();
const NO_JOBS: ReadonlyMap<string, HeldJob> = new Map();

/** What a read of the phone's store answers, read again whenever `watch` changes. A store that will not open gives nothing. */
function useStored<T>(read: () => Promise<T>, nothing: T, watch: unknown): T {
  return valueOr(useAsync(read, watch)[0], nothing);
}

/**
 * The client names the phone holds, by job, from the cards `keepCards` kept:
 * what the close-out names each job by, and the rows of a day the phone kept
 * before the day's list carried names.
 */
export function useNames(watch: unknown = null): ReadonlyMap<string, string> {
  return useStored(keptNames, NO_NAMES, watch);
}

/** Each job the phone holds, locked or not, for the screens that must name a job whose card has gone. */
export function useHeldJobs(watch: unknown = null): ReadonlyMap<string, HeldJob> {
  return useStored(keptJobs, NO_JOBS, watch);
}
