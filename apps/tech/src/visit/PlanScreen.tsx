// The visit plan (docs/prompts/tech-redesign.md, "Visit engine"; docs/decisions/0244-the-visit-engine.md): every screen
// of the visit, done, under way or to do, how many are done, the visit's time gone and when it should finish. A step
// the API refused needs a fix, said in red. A screen done or under way opens from here; one to do waits its turn.

import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { ProgressLine } from "@maneman/ui/Progress";
import { StepMark, type MarkState } from "@maneman/ui/StepMark";
import type { Job } from "../api.ts";
import { visit as copy } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { CardFrame, nameOf } from "../frame/CardFrame.tsx";
import { kindNameLower } from "../lib/kind.ts";
import { done, nextStep, sentBackFor } from "../lib/progress.ts";
import { useMinute } from "../lib/useMinute.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useJob } from "../lib/useDay.ts";
import { clock } from "../lib/when.ts";
import { stepPath } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import { screensOf } from "./engine.ts";
import styles from "./plan.module.css";
import { theirs } from "../lang/index.ts";

type State = MarkState;

/** A step's state in words, read as the plan is drawn so it is in the language now. */
const stateWords = (state: State): string => (state === "fix" ? copy.plan.needsFix : copy.plan.states[state]);

/** When the visit began: the card's start, or the tap on Start visit still on the phone. */
function startedAt(job: Job, queued: readonly Queued[]): number | null {
  if (job.progress.started_at !== null) return Date.parse(job.progress.started_at);
  return queued.find((event) => event.job_id === job.id && event.kind === "start")?.queued_at ?? null;
}

/** How much of the visit's time has gone, from Start visit to its booked end, and when it should finish. */
function TimeGone({ job, queued }: { job: Job; queued: readonly Queued[] }) {
  const now = useMinute();
  if (job.ends_at === null) return null;
  const started = startedAt(job, queued);
  const ends = Date.parse(job.ends_at);
  return (
    <>
      {started !== null && (
        <ProgressLine
          className={styles.bar}
          value={(now.getTime() - started) / Math.max(1, ends - started)}
          tone="accent"
        />
      )}
      <p className={styles.finish}>{copy.plan.finishBy(clock(job.ends_at))}</p>
    </>
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
  return (
    <CardFrame
      title={copy.plan.title}
      sub={copy.whoAndWhat(nameOf(job), kindNameLower(job))}
      back={`/jobs/${job.id}`}
      safety={job.id}
      foot={null}
    >
      <section className={styles.head}>
        <p className={styles.count}>{copy.plan.done(doneCount, screens.length)}</p>
        <TimeGone job={job} queued={queued} />
      </section>
      {toFix.length > 0 && (
        <ProblemCard className={styles.fixCard} title={copy.plan.needsFix}>
          {toFix
            .map((screen) => {
              const reason = sentBackFor(job, queued, screen.event);
              return reason === null ? screen.title : copy.plan.sentBack(screen.title, theirs(reason));
            })
            .join(". ")}
        </ProblemCard>
      )}
      <ListRows className={styles.list} label={copy.plan.title}>
        {screens.map((screen) => {
          const state = stateOf(screen.event);
          return (
            <ListRow
              key={screen.id}
              mark={<StepMark state={state} />}
              title={screen.title}
              end={stateWords(state)}
              endTone={state === "fix" ? "error" : "muted"}
              to={state === "todo" ? undefined : stepPath(job.id, screen.event)}
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
