// One day's jobs: from the API when there is signal, from the phone when there
// is none. The list the API answers is kept, so the next basement opens on it.

import { useCallback, useEffect, useState } from "react";
import { api, type Job, type JobSummary } from "../api.ts";
import { keepDay, keepJob, keptDay, keptJob } from "../store/jobs.ts";

export type Loaded<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  /** `fromPhone` is true when this is what the phone kept, not what the API just said. */
  | { readonly state: "loaded"; readonly value: T; readonly fromPhone: boolean };

function useKept<T>(load: () => Promise<Loaded<T>>): readonly [Loaded<T>, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void load().then((answer) => {
      if (current) setLoaded(answer);
    });
    return () => {
      current = false;
    };
  }, [load, attempt]);

  const retry = useCallback(() => {
    setLoaded({ state: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return [loaded, retry];
}

export function useDay(date: string): readonly [Loaded<readonly JobSummary[]>, () => void] {
  const load = useCallback(async (): Promise<Loaded<readonly JobSummary[]>> => {
    const answer = await api.jobs(date);
    if (answer.ok) {
      await keepDay(date, answer.body.jobs);
      return { state: "loaded", value: answer.body.jobs, fromPhone: false };
    }
    const kept = await keptDay(date);
    return kept === null ? { state: "failed" } : { state: "loaded", value: kept, fromPhone: true };
  }, [date]);
  return useKept(load);
}

/**
 * Once the day's list has arrived, each card it names is fetched and kept, so
 * the phone opens them in a basement: "today's and tomorrow's jobs and client
 * cards are cached" (docs/prompts/phase2-frontend.md). A locked job has no card
 * to keep, and the first call that fails ends the round: there is no signal.
 */
export async function keepCards(jobs: readonly JobSummary[]): Promise<void> {
  for (const job of jobs) {
    if (job.locked) continue;
    const answer = await api.job(job.id);
    if (!answer.ok) return;
    await keepJob(answer.body);
  }
}

export function useJob(id: string): readonly [Loaded<Job>, () => void] {
  const load = useCallback(async (): Promise<Loaded<Job>> => {
    const answer = await api.job(id);
    if (answer.ok) {
      await keepJob(answer.body);
      return { state: "loaded", value: answer.body, fromPhone: false };
    }
    const kept = await keptJob(id);
    return kept === null ? { state: "failed" } : { state: "loaded", value: kept, fromPhone: true };
  }, [id]);
  return useKept(load);
}
