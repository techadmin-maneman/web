// The visit plan (docs/prompts/tech-redesign.md, "Visit engine"; docs/decisions/0244-the-visit-engine.md): every screen
// of the visit, done, under way or to do, how many are done, the visit's time gone and when it should finish. A step
// the API refused needs a fix, said in red. A screen done or under way opens from here; one to do waits its turn.

import { ICONS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { ListRow, ListRows } from "@maneman/ui/ListRow";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { ProgressLine } from "@maneman/ui/Progress";
import type { Job } from "../api.ts";
import { visit as copy } from "../content.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { CardFrame, nameOf } from "../frame/CardFrame.tsx";
import { kindNameLower } from "../lib/kind.ts";
import { done, nextStep } from "../lib/progress.ts";
import { useMinute } from "../lib/useMinute.ts";
import { signatureOf, useOutbox } from "../lib/useOutbox.ts";
import { useJob } from "../lib/useDay.ts";
import { clock } from "../lib/when.ts";
import { stepPath } from "../route.ts";
import type { Queued } from "../store/outbox.ts";
import { screensOf } from "./engine.ts";
import styles from "./plan.module.css";

type State = "done" | "now" | "todo" | "fix";

/** Done, a navy tick; under way, the brass ring; to do, the stone ring; refused, the error's. */
function Marker({ state }: { state: State }) {
  return (
    <span className={styles[state]} aria-hidden="true">
      {state === "done" && <Icon d={ICONS.tick} size="xs" weight="heavy" />}
    </span>
  );
}

const STATE_WORDS: Record<State, string> = {
  done: copy.plan.states.done,
  now: copy.plan.states.now,
  todo: copy.plan.states.todo,
  fix: copy.plan.needsFix,
};

/** How much of the visit's time has gone, from Start visit to its booked end. */
function TimeGone({ job }: { job: Job }) {
  const now = useMinute();
  if (job.progress.started_at === null || job.ends_at === null) return null;
  const started = Date.parse(job.progress.started_at);
  const share = (now.getTime() - started) / Math.max(1, Date.parse(job.ends_at) - started);
  return (
    <>
      <ProgressLine className={styles.bar} value={share} tone="accent" />
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
  const stateOf = (event: string): State => {
    if (refused.has(event)) return "fix";
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
      foot={null}
    >
      <section className={styles.head}>
        <p className={styles.count}>{copy.plan.done(doneCount, screens.length)}</p>
        <TimeGone job={job} />
      </section>
      {toFix.length > 0 && (
        <ProblemCard className={styles.fixCard} title={copy.plan.needsFix}>
          {toFix.map((screen) => screen.title).join(", ")}
        </ProblemCard>
      )}
      <ListRows className={styles.list} label={copy.plan.title}>
        {screens.map((screen) => {
          const state = stateOf(screen.event);
          return (
            <ListRow
              key={screen.id}
              lead={<Marker state={state} />}
              title={screen.title}
              end={STATE_WORDS[state]}
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
