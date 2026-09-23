// What every in-job step needs: the job it belongs to, where it sits in the
// six, and one way to finish it.
//
// Finishing queues the event and moves on. It never waits for the API: a step
// taken in a basement is recorded on the phone and sent when there is signal
// (docs/decisions/0038-offline-writes.md).

import { useCallback } from "react";
import type { Job } from "../api.ts";
import { nextStep, stepNumber, stepsOf } from "../lib/progress.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { go, stepPath, type InJobStep } from "../route.ts";
import type { Loaded } from "../lib/useDay.ts";
import { keepClosed } from "../store/jobs.ts";
import { queue, replay } from "../store/outbox.ts";

export interface Standing {
  readonly loaded: Loaded<Job>;
  readonly retry: () => void;
  readonly at: number;
  readonly of: number;
  /** Queues this step's write and opens the next screen. */
  readonly finish: (body: unknown) => Promise<void>;
  readonly back: () => void;
}

export function useStep(id: string, step: InJobStep): Standing {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  const job = loaded.state === "loaded" ? loaded.value : null;
  const place = job === null ? { at: 1, of: 6 } : stepNumber(job, step);

  const finish = useCallback(
    async (body: unknown) => {
      if (job === null) return;
      await queue(step, id, body);
      // The duration board B4 shows runs from Start job to the outcome, and nothing gives it back.
      if (step === "outcome") await keepClosed(id);
      void replay();
      const remaining = stepsOf(job).slice(stepsOf(job).indexOf(step) + 1);
      const following = remaining[0] ?? nextStep(job, waiting.events);
      go(following === null || step === "outcome" ? `/jobs/${id}/done` : stepPath(id, following));
    },
    [id, job, step, waiting.events],
  );

  const back = useCallback(() => {
    go(`/jobs/${id}`);
  }, [id]);

  return { loaded, retry, at: place.at, of: place.of, finish, back };
}
