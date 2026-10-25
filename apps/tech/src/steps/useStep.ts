// What every in-job step needs: its job, and one way to finish it, which queues the event and moves on without waiting
// for the API (docs/decisions/0038-offline-writes.md). A step the API refused opens again to be put right; a closed job
// takes no more steps.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import { apiNow } from "@maneman/web-kit/clock";
import type { EventBody, Job, OutcomeRequest } from "../api.ts";
import { closed, done, stepsOf } from "../lib/progress.ts";
import type { KeptLoad } from "../lib/useDay.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { go, redirect, stepPath, type InJobStep } from "../route.ts";
import { keepClosed } from "../store/jobs.ts";
import { correct, queue, replay, type Queued } from "../store/outbox.ts";

const LOADING: KeptLoad<Job> = { state: "loading" };

interface Standing<K extends InJobStep> {
  /** Loading until the outbox has been read as well, so a step being put right starts from what it sent. */
  readonly loaded: KeptLoad<Job>;
  readonly retry: () => void;
  /** This step as it was sent and refused, when the technician is putting it right. */
  readonly refused: Queued | null;
  /** Every write still on the phone, of every job. */
  readonly queued: readonly Queued[];
  /** Queues this step's write, once however often it is tapped, and opens the next screen. */
  readonly finish: (body: EventBody<K>) => Promise<void>;
  /** Closes the job from this step, as "Can't fit today" does at the piece, and opens the close-out. */
  readonly closeWith: (outcome: EventBody<"outcome">) => Promise<void>;
  readonly back: () => void;
}

export function useStep<K extends InJobStep>(id: string, step: K): Standing<K> {
  const waiting = useOutbox();
  const [card, retry] = useJob(id, signatureOf(waiting));
  const [, once] = useOneAtATime();
  const [finishing, setFinishing] = useState(false);
  const loaded = waiting.read ? card : LOADING;
  const job = loaded.state === "loaded" ? loaded.value : null;
  const refused =
    waiting.events.find((event) => event.job_id === id && event.kind === step && event.state === "refused") ?? null;
  // A step being put right opens: the outcome queued behind it has not landed. Finishing a step can close the job,
  // and then the screen moves on by itself.
  const leaves = !finishing && job !== null && refused === null && closed(job, waiting.events);

  useEffect(() => {
    if (leaves) redirect(`/jobs/${id}`);
  }, [leaves, id]);

  const finish = (body: EventBody<K>) =>
    once(async () => {
      if (job === null) return;
      setFinishing(true);
      if (refused === null) await queue(step, id, body, job.starts_at);
      else await correct(refused.seq, body);
      // The duration the close-out shows runs from Start job to the outcome, and nothing gives it back.
      if (step === "outcome") await keepClosed(id, apiNow(), body as OutcomeRequest);
      void replay();

      const sent = done(job, waiting.events);
      const following = stepsOf(job)
        .slice(stepsOf(job).indexOf(step) + 1)
        .find((later) => !sent.has(later));
      if (following === undefined || step === "outcome") redirect(`/jobs/${id}/done`);
      else go(stepPath(id, following));
    });

  const closeWith = (outcome: EventBody<"outcome">) =>
    once(async () => {
      if (job === null) return;
      setFinishing(true);
      await queue("outcome", id, outcome, job.starts_at);
      await keepClosed(id, apiNow(), outcome);
      void replay();
      redirect(`/jobs/${id}/done`);
    });

  const back = () => {
    go(`/jobs/${id}`);
  };

  return { loaded: leaves ? LOADING : loaded, retry, refused, queued: waiting.events, finish, closeWith, back };
}
