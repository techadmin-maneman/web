// Step 2: the visit's checklist. One 88 px row per item, a 36 px box
// each, and the action dim until the list is finished.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given. The title names the visit
// the list is for: the board titles a service visit's. A consultation and fit in
// one visit runs the consultation's list and the fit's, which the API gives as
// one, or the consultation's alone once the client decided against the fit at
// the piece step before it.

import { CheckRow } from "@maneman/ui/CheckRow";
import { useEffect, useState } from "react";
import type { EventBody, Job } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { BOX_TICK_STROKE } from "../icons.ts";
import { declinedTheFit } from "../lib/progress.ts";
import { Failed, Loading } from "../states/States.tsx";
import { put, remove } from "../store/db.ts";
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

/** The list once the job is in hand: a refused list starts as it was ticked, else as the phone kept it. */
function Ticking({
  job,
  declined,
  refused,
  draft,
  onFinish,
  onBack,
}: {
  job: Job;
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

  return (
    <StepFrame
      title={titleOf(job, declined)}
      at={done.length}
      of={items.length}
      action={copy.next}
      ready={all}
      unfinished={copy.checklist.unfinished}
      notice={refused === null ? null : copy.corrected.other}
      onBack={onBack}
      onAction={() => {
        remove("device", "checklist_draft").catch(() => undefined);
        onFinish({ done: [...done] });
      }}
    >
      <ul className={styles.list}>
        {items.map((item) => {
          const ticked = done.includes(item.id);
          return (
            <li key={item.id}>
              <CheckRow
                done={ticked}
                tickStroke={BOX_TICK_STROKE}
                onToggle={() => {
                  setDone((already) =>
                    already.includes(item.id) ? already.filter((one) => one !== item.id) : [...already, item.id],
                  );
                }}
              >
                {item.label}
              </CheckRow>
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}

export function Checklist({ id }: { id: string }) {
  const { loaded, retry, refused, queued, finish, back } = useStep(id, "checklist");
  const kept = useDraft("checklist_draft", id);

  if (loaded.state === "loading" || !kept.read) return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }
  const job = loaded.value;
  return (
    <Ticking
      job={job}
      declined={declinedTheFit(job, queued)}
      refused={refused}
      draft={kept.draft}
      onFinish={(body) => void finish(body)}
      onBack={back}
    />
  );
}
