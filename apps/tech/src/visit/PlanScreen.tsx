// The visit plan (docs/prompts/tech-redesign.md, "Visit engine"; docs/decisions/0244-the-visit-engine.md), as the
// prototype draws it: the client and the visit with when it started, a step ops could not accept first, how many are
// done beside when to finish with the visit's time gone beneath, then each screen numbered with what it is, and
// Continue to the one under way. A screen done or under way opens from here; one to do waits its turn.

import { Button } from "@maneman/ui/Button";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { ProgressLine } from "@maneman/ui/Progress";
import { StepMark, type MarkState } from "@maneman/ui/StepMark";
import type { Job } from "../api.ts";
import { today, visit as copy } from "../content.ts";
import { Chevron } from "../frame/Chevron.tsx";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { CardFrame, nameOf } from "../frame/CardFrame.tsx";
import { stepLine } from "../guides/index.ts";
import { kindNameLower } from "../lib/kind.ts";
import { done, nextStep, sentBackFor } from "../lib/progress.ts";
import { useMinute } from "../lib/useMinute.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useJob } from "../lib/useDay.ts";
import { clock } from "../lib/when.ts";
import { go, stepPath } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import { screensOf, type Screen } from "./engine.ts";
import styles from "./plan.module.css";

type State = MarkState;

/** When the visit began: the card's start, or the tap on Start visit still on the phone. */
function startedAt(job: Job, queued: readonly Queued[]): number | null {
  if (job.progress.started_at !== null) return Date.parse(job.progress.started_at);
  return queued.find((event) => event.job_id === job.id && event.kind === "start")?.queued_at ?? null;
}

/** How much of the visit's time has gone, from Start visit to its booked end, in brass (ADR 0244, decision 3). */
function TimeGone({ job, started }: { job: Job; started: number | null }) {
  const now = useMinute();
  if (job.ends_at === null || started === null) return null;
  const ends = Date.parse(job.ends_at);
  return (
    <ProgressLine
      className={styles.bar}
      value={(now.getTime() - started) / Math.max(1, ends - started)}
      tone="accent"
    />
  );
}

/** A step's line: done, needing a fix, or what it is; a step of tasks counts them. */
function lineOf(job: Job, screen: Screen, state: State): string {
  if (state === "done") return copy.plan.stepDone;
  if (state === "fix") return copy.plan.needsFix;
  if (screen.id === "tasks" && job.checklist.length > 0) return copy.plan.tasks(job.checklist.length);
  return stepLine(screen.id, job.type === "consultation" && !job.one_visit);
}

/**
 * A step to fix, first, opening it: one ops sent back says so, naming the step, with their reason as they wrote it,
 * never put in Hindi; one the API refused needs a fix.
 */
function FixCard({ job, queued, screen }: { job: Job; queued: readonly Queued[]; screen: Screen }) {
  const reason = sentBackFor(job, queued, screen.event);
  const named = reason === null ? undefined : (today.toFixSteps as Partial<Record<string, string>>)[screen.event];
  return (
    <ProblemCard
      className={styles.fixCard}
      title={named === undefined ? copy.plan.needsFix : copy.plan.couldNotAccept(named)}
      onOpen={() => {
        go(stepPath(job.id, screen.event));
      }}
    >
      {reason ?? screen.title}
    </ProblemCard>
  );
}

function Plan({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  const screens = screensOf(job);
  const sent = done(job, queued);
  const now = nextStep(job, queued);
  const refused = new Set<string>(
    queued.filter((event) => event.job_id === job.id && event.state === "refused").map((event) => event.kind),
  );
  // A step ops sent back needs a fix as a refused one does, and says what they want put right (ADR 0246).
  const stateOf = (event: string): State => {
    if (refused.has(event) || sentBackFor(job, queued, event) !== null) return "fix";
    if (sent.has(event)) return "done";
    return event === now ? "now" : "todo";
  };
  const doneCount = screens.filter((screen) => stateOf(screen.event) === "done").length;
  const toFix = screens.filter((screen) => stateOf(screen.event) === "fix");
  const started = startedAt(job, queued);
  const underWay = screens.find((screen) => screen.event === now);
  return (
    <CardFrame
      title={copy.whoAndWhat(nameOf(job), kindNameLower(job))}
      sub={started === null ? copy.plan.title : copy.plan.started(clock(new Date(started).toISOString()))}
      back={`/jobs/${job.id}`}
      safety={job.id}
      foot={
        underWay === undefined ? null : (
          <Button
            variant="primary"
            size="action"
            onClick={() => {
              go(stepPath(job.id, underWay.event));
            }}
          >
            {copy.plan.continue}
          </Button>
        )
      }
    >
      {toFix.length > 0 && (
        <div className={styles.fixes}>
          {toFix.map((screen) => (
            <FixCard key={screen.id} job={job} queued={queued} screen={screen} />
          ))}
        </div>
      )}
      <section className={styles.head}>
        <p className={styles.counts}>
          <span className={styles.count}>{copy.plan.done(doneCount, screens.length)}</span>
          {job.ends_at !== null && <span className={styles.finish}>{copy.plan.finishBy(clock(job.ends_at))}</span>}
        </p>
        <TimeGone job={job} started={started} />
      </section>
      <ListRows className={styles.list} label={copy.plan.title}>
        {screens.map((screen, index) => {
          const state = stateOf(screen.event);
          const opens = state !== "todo";
          return (
            <ListRow
              key={screen.id}
              mark={<StepMark state={state} n={index + 1} />}
              title={screen.title}
              meta={<span className={state === "fix" ? styles.fix : undefined}>{lineOf(job, screen, state)}</span>}
              end={opens ? <Chevron /> : undefined}
              to={opens ? stepPath(job.id, screen.event) : undefined}
            />
          );
        })}
      </ListRows>
    </CardFrame>
  );
}

export function PlanScreen({ id }: { id: string }) {
  const waiting = useOutbox();
  const [loaded, retry] = useJob(id, signatureOf(waiting));
  if (loaded.state === "loading") return <Loading onPaper />;
  if (loaded.state === "failed") return <JobFailed failed={loaded} onRetry={retry} onPaper />;
  return <Plan job={loaded.value} queued={waiting.events} />;
}
