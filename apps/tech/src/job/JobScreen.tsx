// Boards A3 and B5: one job's card, and beneath it the stage the job is at.
//
// A3 is the card — client, time and type, the badge, the address with its
// access notes and Navigate, the piece and the last visit. B5 is the evidence
// chain that follows it: arrive, wait, and either start the job or close it as
// a no-show. They are one screen because they are one moment at the door.
//
// What the card offers follows the job's stage (../lib/progress.ts): one gold
// action at the foot at most, and never one the API would refuse. A job ops
// changed under the phone offers nothing to press on with and says what
// changed; a started job offers its next step and nothing of the door's; a
// closed one reads as closed.

import { capsLook } from "@maneman/ui/Caps";
import { classes } from "@maneman/ui/classes";
import { Button } from "@maneman/ui/Button";
import type { ReactNode } from "react";
import type { Job } from "../api.ts";
import { closeOut as closeOutCopy, job as copy, whatStopped } from "../content.ts";
import { nextStep, outcomeOf, stageOf, type Stage } from "../lib/progress.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { dayAfter, todayInIndia } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import { Failed, Loading } from "../states/States.tsx";
import type { Queued } from "../store/outbox.ts";
import { CardFrame } from "./CardFrame.tsx";
import { JobCard } from "./JobCard.tsx";
import { NotHome } from "./NotHome.tsx";
import frame from "../components/frame.module.css";
import styles from "./job.module.css";

/** What ops changed, in the app's words: the new time when the card now carries one, else the field that moved. */
function whatChanged(job: Job, queued: readonly Queued[]): string {
  const moved = queued.find((event) => event.job_id === job.id && event.state === "superseded");
  if (moved === undefined) return "";
  return whatStopped({ ...moved, startsAt: moved.starts_at ?? null }, new Date(), job.starts_at);
}

function Changed({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  return (
    <section className={styles.changed} role="alert" aria-labelledby="changed-title">
      <h2 className={capsLook(styles.changedTitle)} id="changed-title">
        {copy.changed.title}
      </h2>
      <p className={styles.changedLine}>{whatChanged(job, queued)}</p>
      <p className={styles.stageNote}>{copy.changed.body}</p>
    </section>
  );
}

/** The line that says where a job stands, for the stages that are not the door. */
function StateLine({ stage, job, queued }: { stage: Stage; job: Job; queued: readonly Queued[] }) {
  if (stage === "started") return <p className={styles.state}>{copy.states.inProgress}</p>;
  if (stage === "closed") {
    const outcome = outcomeOf(job, queued) ?? "done";
    return <p className={styles.state}>{copy.closedAs(closeOutCopy.outcomes[outcome])}</p>;
  }
  if (stage === "not_today") {
    const tomorrow = job.date === dayAfter(todayInIndia());
    return <p className={styles.state}>{tomorrow ? copy.notToday.tomorrow : copy.notToday.other}</p>;
  }
  return null;
}

/** The action at the foot: the next step of a started job, or the way to a closed one's close-out. */
function footFor(stage: Stage, job: Job, queued: readonly Queued[]): ReactNode {
  if (stage === "started") {
    const step = nextStep(job, queued);
    return (
      <Button
        variant="gold"
        size="action"
        className={frame.action}
        onClick={() => {
          go(step === null ? `/jobs/${job.id}/done` : stepPath(job.id, step));
        }}
      >
        {copy.continueJob}
      </Button>
    );
  }
  if (stage === "closed") {
    return (
      <Button
        variant="outlineOnInk"
        size="control"
        className={classes(styles.second, styles.atFoot)}
        onClick={() => {
          go(`/jobs/${job.id}/done`);
        }}
      >
        {copy.seeCloseOut}
      </Button>
    );
  }
  return null;
}

export function JobScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return (
      <main className={frame.screen}>
        <Failed message={copy.failed} retry={copy.retry} onRetry={retry} requestId={loaded.requestId} />
      </main>
    );
  }

  const job = loaded.value;
  const queued = waiting.events;
  const stage = stageOf(job, queued, todayInIndia());

  if (stage === "door") return <NotHome job={job} queued={queued} card={<JobCard job={job} />} />;

  return (
    <CardFrame job={job} foot={footFor(stage, job, queued)}>
      {stage === "changed" && <Changed job={job} queued={queued} />}
      <StateLine stage={stage} job={job} queued={queued} />
      <JobCard job={job} />
    </CardFrame>
  );
}
