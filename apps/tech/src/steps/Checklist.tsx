// The guided tasks (docs/prompts/tech-redesign.md, "Guided tasks"): the visit's checklist, one item a screen, each with
// the training lead's words for it (../visit/tasks.ts), the client's alerts above, and its Done. The action goes to
// the next task, and on the last, once every one is done, to the step after.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given. The title names the visit
// the list is for: the board titles a service visit's. A consultation and fit in
// one visit runs the consultation's list and the fit's, which the API gives as
// one, or the consultation's alone once the client decided against the fit at
// the piece step before it.

import { Button } from "@maneman/ui/Button";
import { CheckRow } from "@maneman/ui/CheckRow";
import { ProblemCard } from "@maneman/ui/ProblemCard";
import { useEffect, useState } from "react";
import type { EventBody, Job } from "../api.ts";
import { clientRecord, oneVisit, steps as copy, visit } from "../content.ts";
import { fitsNothingToday } from "../lib/progress.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { put, remove } from "../store/db.ts";
import { taskFor } from "../visit/index.ts";
import type { Queued } from "../store/outbox.ts";
import { useDraft, type Draft } from "./drafts.ts";
import { checklistSent } from "./sent-before.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

/** The list's title: a declined one visit's, a one visit's, the visit's kind, or the step's where it is not known. */
function titleOf(job: Job, declined: boolean): string {
  if (declined) return copy.checklistTitles.consultation;
  if (job.one_visit) return oneVisit.checklist;
  return job.type === null ? copy.titles.checklist : copy.checklistTitles[job.type];
}

/**
 * The list once the job is in hand: a refused list starts as it was ticked, else as the phone kept it, and one already
 * finished opens on its last task, ready to send.
 */
function Ticking({
  job,
  declined,
  refused,
  draft,
  onFinish,
  onBack,
}: {
  job: Job;
  /** Nothing fitted today, the fit declined or booked for later: the consultation's list alone. */
  declined: boolean;
  refused: Queued | null;
  draft: Draft<"checklist_draft"> | null;
  onFinish: (body: EventBody<"checklist">) => void;
  onBack: () => void;
}) {
  const items = declined ? job.checklist_if_declined : job.checklist;
  const listed = items.map((item) => item.id);
  const [done, setDone] = useState<readonly string[]>(() =>
    refused === null && draft !== null
      ? draft.done.filter((id) => listed.includes(id))
      : checklistSent(refused, listed),
  );
  const all = items.length > 0 && done.length === items.length;

  // Kept as ticked: a full phone loses the ticks, never the step.
  useEffect(() => {
    put("device", { key: "checklist_draft", job_id: job.id, done }).catch(() => undefined);
  }, [job.id, done]);

  const [at, setAt] = useState(() => (all ? items.length - 1 : 0));
  const item = items[Math.min(at, items.length - 1)];
  const last = at >= items.length - 1;
  const toggle = (id: string) => {
    setDone((already) => (already.includes(id) ? already.filter((one) => one !== id) : [...already, id]));
  };
  return (
    <StepFrame
      title={titleOf(job, declined)}
      page={at}
      action={last ? undefined : visit.nextTask}
      ready={!last || all}
      unfinished={copy.checklist.unfinished}
      notice={refused === null ? null : copy.corrected.other}
      onBack={() => {
        if (at > 0) setAt(at - 1);
        else onBack();
      }}
      onAction={() => {
        if (!last) {
          setAt(at + 1);
          return;
        }
        remove("device", "checklist_draft").catch(() => undefined);
        onFinish({ done: [...done] });
      }}
    >
      <Alerts job={job} />
      {item !== undefined && (
        <Task item={item} at={at} total={items.length} done={done.includes(item.id)} onToggle={toggle} />
      )}
      {!all && items.length > 1 && (
        <Button
          variant="outline"
          size="control"
          className={styles.tickAll}
          onClick={() => {
            setDone(listed);
            setAt(items.length - 1);
          }}
        >
          {copy.checklist.all}
        </Button>
      )}
    </StepFrame>
  );
}

/** The client's alerts, above every task (docs/prompts/tech-redesign.md, "Guided tasks"). */
function Alerts({ job }: { job: Job }) {
  if (job.client_alerts.length === 0) return null;
  return (
    <ProblemCard className={styles.alerts} title={clientRecord.alerts}>
      {job.client_alerts.map((alert) => alert.body).join(" ")}
    </ProblemCard>
  );
}

/** One guided task: how far through, its words from the training lead's file, and its Done. */
function Task(props: {
  item: { readonly id: string; readonly label: string };
  at: number;
  total: number;
  done: boolean;
  onToggle: (id: string) => void;
}) {
  const words = taskFor(props.item);
  return (
    <section className={styles.task} aria-labelledby="task-title">
      <p className={styles.taskCount}>{visit.task(props.at + 1, props.total)}</p>
      <h2 className={styles.taskTitle} id="task-title">
        {words.title}
      </h2>
      {words.reference !== "" && (
        <div className={styles.reference} role="img" aria-label={visit.reference(words.reference)}>
          {visit.reference(words.reference)}
        </div>
      )}
      {words.how.length > 0 && (
        <ol className={styles.how}>
          {words.how.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}
      {words.watch !== null && (
        <div className={styles.watch}>
          <p className={styles.watchTitle}>{visit.watchFor}</p>
          <p className={styles.watchLine}>{words.watch}</p>
        </div>
      )}
      <ul className={styles.taskDone}>
        <li>
          <CheckRow
            done={props.done}
            tickWeight="heavy"
            onToggle={() => {
              props.onToggle(props.item.id);
            }}
          >
            {props.item.label}
          </CheckRow>
        </li>
      </ul>
    </section>
  );
}

export function Checklist({ id }: { id: string }) {
  const { loaded, retry, refused, queued, finish, back } = useStep(id, "checklist");
  const kept = useDraft("checklist_draft", id);

  if (loaded.state === "loading" || !kept.read) return <Loading />;
  if (loaded.state === "failed") {
    return <JobFailed failed={loaded} onRetry={retry} />;
  }
  const job = loaded.value;
  return (
    <Ticking
      job={job}
      declined={fitsNothingToday(job, queued)}
      refused={refused}
      draft={kept.draft}
      onFinish={(body) => void finish(body)}
      onBack={back}
    />
  );
}
