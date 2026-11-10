// One job (docs/prompts/tech-redesign.md, "Job"; docs/decisions/0243-job-and-the-door.md): what is known of it, and
// in the bar at its foot the one action its stage takes. Check in, from the job's opening time; At the door once
// checked in; Continue once the visit has begun; View summary once it has closed. A job ops changed under the phone
// offers nothing to press on with and says what changed; one on another day says when it can be worked.

import { Button } from "@maneman/ui/Button";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import type { ReactNode } from "react";
import type { Job } from "../api.ts";
import { closeOut as closeOutCopy, job as copy, whatStopped } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { nextStep, outcomeOf, stageOf, type Stage } from "../lib/progress.ts";
import { useJob } from "../lib/useDay.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { apiDate, dayAfter, todayInIndia } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import { CardFrame, nameOf, whenOf } from "./CardFrame.tsx";
import { CheckInFailed, useCheckIn } from "./CheckIn.tsx";
import { JobCard } from "./JobCard.tsx";
import styles from "./job-screen.module.css";

/** What ops changed, in the app's words: the new time when the card now carries one, else the field that moved. */
function whatChanged(job: Job, queued: readonly Queued[]): string {
  const moved = queued.find((event) => event.job_id === job.id && event.state === "superseded");
  if (moved === undefined) return "";
  return whatStopped({ ...moved, startsAt: moved.starts_at ?? null }, apiDate(), job.starts_at);
}

/** The line that says where a job stands, for the stages that are not the door. */
function stateLine(stage: Stage, job: Job, queued: readonly Queued[]): string | null {
  if (stage === "started") return copy.states.inProgress;
  if (stage === "closed") return copy.closedAs(closeOutCopy.outcomes[outcomeOf(job, queued) ?? "done"]);
  if (stage === "not_today") {
    return job.date === dayAfter(todayInIndia()) ? copy.notToday.tomorrow : copy.notToday.other;
  }
  return null;
}

/** The bar's action: the next step of a started job, or the way to a closed one's summary. */
function footFor(stage: Stage, job: Job, queued: readonly Queued[]): ReactNode {
  if (stage === "started") {
    const step = nextStep(job, queued);
    return (
      <Button
        variant="primary"
        size="action"
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
        variant="outline"
        size="action"
        onClick={() => {
          go(`/jobs/${job.id}/done`);
        }}
      >
        {copy.viewSummary}
      </Button>
    );
  }
  return null;
}

/** A job today, at the door: Check in, or At the door once checked in; how far a failed one was measured. */
function AtTheJob({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  const checkIn = useCheckIn(job, queued);
  if (checkIn.here) {
    return (
      <CardFrame
        title={nameOf(job)}
        sub={whenOf(job)}
        foot={
          <Button
            variant="primary"
            size="action"
            onClick={() => {
              go(`/jobs/${job.id}/door`);
            }}
          >
            {copy.atTheDoor}
          </Button>
        }
      >
        <JobCard job={job} />
      </CardFrame>
    );
  }
  return (
    <CardFrame
      title={nameOf(job)}
      sub={whenOf(job)}
      helper={checkIn.helper}
      foot={(helperId) => (
        <Button
          variant="primary"
          size="action"
          disabled={checkIn.busy || checkIn.notYet}
          busy={checkIn.busy}
          aria-describedby={helperId}
          onClick={checkIn.arrive}
        >
          {checkIn.failed === null ? copy.checkIn : copy.retry}
        </Button>
      )}
    >
      {checkIn.failed !== null && <CheckInFailed distance={checkIn.failed.distance} />}
      <JobCard job={job} />
    </CardFrame>
  );
}

export function JobScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));

  if (loaded.state === "loading") return <Loading onPaper />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} onPaper />;

  const job = loaded.value;
  const queued = waiting.events;
  const stage = stageOf(job, queued, todayInIndia());
  if (stage === "door") return <AtTheJob job={job} queued={queued} />;

  const line = stateLine(stage, job, queued);
  return (
    <CardFrame title={nameOf(job)} sub={whenOf(job)} foot={footFor(stage, job, queued)}>
      {stage === "changed" && (
        <ProblemCard className={styles.changed} title={copy.changed.title} live level={2}>
          {whatChanged(job, queued)} {copy.changed.body}
        </ProblemCard>
      )}
      {line !== null && <p className={styles.state}>{line}</p>}
      <JobCard job={job} />
    </CardFrame>
  );
}
