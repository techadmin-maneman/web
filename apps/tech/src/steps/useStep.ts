// What every in-job step needs: the job it belongs to, and one way to finish it.
//
// Finishing queues the event and moves on. It never waits for the API: a step
// taken in a basement is recorded on the phone and sent when there is signal
// (docs/decisions/0038-offline-writes.md).
//
// A step the API refused — a label it would not take — is opened again to be
// put right, starting from what it sent. Finishing it then sends the corrected
// step in the place the refused one had, and the steps queued behind it follow
// (../store/outbox.ts).

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import type { Job } from "../api.ts";
import { done, stepsOf } from "../lib/progress.ts";
import type { Loaded } from "../lib/useDay.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { go, stepPath, type InJobStep } from "../route.ts";
import { keepClosed } from "../store/jobs.ts";
import { correct, queue, replay, type Queued } from "../store/outbox.ts";

const LOADING: Loaded<Job> = { state: "loading" };

export interface Standing {
  /** Loading until the outbox has been read as well, so a step being put right starts from what it sent. */
  readonly loaded: Loaded<Job>;
  readonly retry: () => void;
  /** This step as it was sent and refused, when the technician is putting it right. */
  readonly refused: Queued | null;
  /** Queues this step's write, once however often it is tapped, and opens the next screen. */
  readonly finish: (body: unknown) => Promise<void>;
  readonly back: () => void;
}

export function useStep(id: string, step: InJobStep): Standing {
  const waiting = useOutbox();
  const [card, retry] = useJob(id, signatureOf(waiting));
  const [, once] = useOneAtATime();
  const loaded = waiting.read ? card : LOADING;
  const job = loaded.state === "loaded" ? loaded.value : null;
  const refused =
    waiting.events.find((event) => event.job_id === id && event.kind === step && event.state === "refused") ?? null;

  const finish = (body: unknown) =>
    once(async () => {
      if (job === null) return;
      if (refused === null) await queue(step, id, body, job.starts_at);
      else await correct(refused.seq, body);
      // The duration board B4 shows runs from Start job to the outcome, and nothing gives it back.
      if (step === "outcome") await keepClosed(id);
      void replay();

      const sent = done(job, waiting.events);
      const following = stepsOf(job)
        .slice(stepsOf(job).indexOf(step) + 1)
        .find((later) => !sent.has(later));
      go(following === undefined || step === "outcome" ? `/jobs/${id}/done` : stepPath(id, following));
    });

  const back = () => {
    go(`/jobs/${id}`);
  };

  return { loaded, retry, refused, finish, back };
}
