// One day's jobs: from the API when there is signal, from the phone when there
// is none. The list the API answers is kept, so the next basement opens on it,
// and whatever the phone no longer needs is let go of at the same moment.
//
// The phone's copy stands in only when the API cannot be reached. Any other
// answer is the API's word: a 401 ends the session, and App wipes the phone
// (apps/tech/src/App.tsx); a 404 says the job is not this technician's. Showing
// what the phone kept after either would show what the API has just refused.

import { useCallback, useEffect, useState } from "react";
import { api, unreachable, type Job, type JobSummary } from "../api.ts";
import { forgetOld, keepDay, keepJob, keptDay, keptJob, keptNames } from "../store/jobs.ts";
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

function useKept<T>(load: () => Promise<Loaded<T>>, watch: unknown = null): readonly [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void load().then(
      (answer) => {
        if (current) setLoaded(answer);
      },
      () => {
        if (current) setLoaded(failed(null));
      },
    );
    return () => {
      current = false;
    };
  }, [load, attempt, watch]);

  const retry = useCallback(() => {
    setLoaded({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return [loaded, retry];
}

export function useDay(date: string): readonly [Loaded<readonly JobSummary[]>, () => void] {
  const load = useCallback(() => loadDay(date), [date]);
  return useKept(load);
}

/**
 * Once the day's list has arrived, each card it names is fetched and kept, so
 * the phone opens them in a basement: "today's and tomorrow's jobs and client
 * cards are cached" (docs/prompts/phase2-frontend.md). A locked job has no card
 * to keep, and the first call that fails ends the round: there is no signal,
 * or no room.
 */
export async function keepCards(jobs: readonly JobSummary[]): Promise<void> {
  for (const job of jobs) {
    if (!job.unlocked) continue;
    const answer = await api.job(job.id);
    if (!answer.ok) return;
    try {
      await keepJob(answer.body);
    } catch {
      return;
    }
  }
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

/**
 * The client names the phone holds, by job. The day's list carries none — the
 * API gives a client only with the card, and only from the day before — so the
 * rows, the waiting screen and the close-out all read what `keepCards` kept.
 */
export function useNames(watch: unknown = null): ReadonlyMap<string, string> {
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let current = true;
    void keptNames().then(
      (found) => {
        if (current) setNames(found);
      },
      () => {
        // A store that will not open has no names to give; the rows go without.
      },
    );
    return () => {
      current = false;
    };
  }, [watch]);
  return names;
}
