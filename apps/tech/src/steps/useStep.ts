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
//
// A closed job takes no more steps. The close-out takes the outcome's place in
// the history, and a step screen opened on a closed job, by Back or an old link,
// goes to the job's card instead.

import { useOneAtATime } from "@maneman/ui/useOneAtATime";
import { useEffect, useState } from "react";
import type { EventBody, Job } from "../api.ts";
import { closed, done, stepsOf } from "../lib/progress.ts";
import type { Loaded } from "../lib/useDay.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { go, redirect, stepPath, type InJobStep } from "../route.ts";
import { keepClosed } from "../store/jobs.ts";
import { correct, queue, replay, type Queued } from "../store/outbox.ts";

const LOADING: Loaded<Job> = { state: "loading" };

export interface Standing<K extends InJobStep> {
  /** Loading until the outbox has been read as well, so a step being put right starts from what it sent. */
  readonly loaded: Loaded<Job>;
  readonly retry: () => void;
  /** This step as it was sent and refused, when the technician is putting it right. */
  readonly refused: Queued | null;
  /** Every write still on the phone, of every job. */
  readonly queued: readonly Queued[];
  /** Queues this step's write, once however often it is tapped, and opens the next screen. */
  readonly finish: (body: EventBody<K>) => Promise<void>;
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
      // The duration board B4 shows runs from Start job to the outcome, and nothing gives it back.
      if (step === "outcome") await keepClosed(id);
      void replay();

      const sent = done(job, waiting.events);
      const following = stepsOf(job)
        .slice(stepsOf(job).indexOf(step) + 1)
        .find((later) => !sent.has(later));
      if (following === undefined || step === "outcome") redirect(`/jobs/${id}/done`);
      else go(stepPath(id, following));
    });

  const back = () => {
    go(`/jobs/${id}`);
  };

  return { loaded: leaves ? LOADING : loaded, retry, refused, queued: waiting.events, finish, back };
}
