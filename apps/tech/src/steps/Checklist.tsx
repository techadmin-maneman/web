// The guided tasks (docs/prompts/tech-redesign.md, "Guided tasks"): the visit's checklist, one item a screen, each with
// the training lead's words for it (../visit/tasks.ts) and the client's alerts under its name. Next task goes to the
// next, and the last to the step after, the list sent as done.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given. The title names the visit
// the list is for: the board titles a service visit's. A consultation and fit in
// one visit runs the consultation's list and the fit's, which the API gives as
// one, or the consultation's alone once the client decided against the fit at
// the piece step before it.

import { ProblemCard } from "@maneman/ui/ProblemCard";
import { useEffect, useState } from "react";
import type { EventBody, Job } from "../api.ts";
import { clientRecord, oneVisit, steps as copy, visit } from "../content.ts";
import { fitsNothingToday } from "../lib/progress.ts";
import { JobFailed } from "../frame/JobFailed.tsx";
import { Loading } from "../frame/States.tsx";
import { put, remove } from "../store/db.ts";
import { taskFor } from "../visit/index.ts";
import { TaskGuide } from "./TaskGuide.tsx";
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
 * The tasks once the job is in hand, one a screen, worked through by Next task; the last lands the list with every item
 * done (docs/decisions/0258-the-technician-design-pass.md). A list sent before and refused opens where it stood, and
 * one the phone kept opens on the task the technician was on.
 */
function Tasks({
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
  const [at, setAt] = useState(() => {
    const listed = items.map((item) => item.id);
    const passed =
      refused === null && draft !== null
        ? draft.done.filter((id) => listed.includes(id)).length
        : checklistSent(refused, listed).length;
    return Math.min(passed, Math.max(0, items.length - 1));
  });

  // Kept as the tasks passed: a phone closed mid-way opens on the task it was on.
  useEffect(() => {
    const passed = items.slice(0, at).map((item) => item.id);
    put("device", { key: "checklist_draft", job_id: job.id, done: passed }).catch(() => undefined);
  }, [job.id, items, at]);

  const item = items[Math.min(at, items.length - 1)];
  const last = at >= items.length - 1;
  return (
    <StepFrame
      title={titleOf(job, declined)}
      page={at}
      action={last ? undefined : visit.nextTask}
      ready
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
        onFinish({ done: items.map((each) => each.id) });
      }}
    >
      {item !== undefined && <Task job={job} item={item} at={at} total={items.length} />}
    </StepFrame>
  );
}

/** The client's alerts, in the task under its title, as the design has them. */
function Alerts({ job }: { job: Job }) {
  if (job.client_alerts.length === 0) return null;
  return (
    <ProblemCard className={styles.alerts} title={clientRecord.alertLabel} runIn>
      {job.client_alerts.map((alert) => alert.body).join(" ")}
    </ProblemCard>
  );
}

/** One guided task: how far through, its name, the client's alerts, and its words from the training lead's file. */
function Task(props: { job: Job; item: { readonly id: string; readonly label: string }; at: number; total: number }) {
  const words = taskFor(props.item);
  return (
    <section className={styles.task} aria-labelledby="task-title">
      <p className={styles.taskCount}>{visit.task(props.at + 1, props.total)}</p>
      <h2 className={styles.taskTitle} id="task-title">
        {words.title}
      </h2>
      <Alerts job={props.job} />
      <TaskGuide words={words} />
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
    <Tasks
      job={job}
      declined={fitsNothingToday(job, queued)}
      refused={refused}
      draft={kept.draft}
      onFinish={(body) => void finish(body)}
      onBack={back}
    />
  );
}
