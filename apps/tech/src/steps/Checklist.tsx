// Board B2, step 2: the visit's checklist. One 88 px row per item, a 36 px box
// each, and the action dim until the list is finished.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given. The title names the visit
// the list is for: the board titles a service visit's. A consultation and fit in
// one visit runs the consultation's list and the fit's, which the API gives as
// one, or the consultation's alone once the client decided against the fit at
// the piece step before it.

import { GLYPHS } from "@maneman/brand/icons";
import { Icon } from "@maneman/ui/Icon";
import { useState } from "react";
import type { Job } from "../api.ts";
import { job as jobCopy, oneVisit, steps as copy } from "../content.ts";
import { BOX_TICK_STROKE } from "../icons.ts";
import { declinedTheFit } from "../lib/progress.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

/** The list's title: a declined one visit's, a one visit's, the visit's kind, or the step's where it is not known. */
function titleOf(job: Job, declined: boolean): string {
  if (declined) return copy.checklistTitles.consultation;
  if (job.one_visit) return oneVisit.checklist;
  return job.type === null ? copy.titles.checklist : copy.checklistTitles[job.type];
}

export function Checklist({ id }: { id: string }) {
  const { loaded, retry, refused, queued, finish, back } = useStep(id, "checklist");
  const [done, setDone] = useState<readonly string[]>([]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") {
    return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} requestId={loaded.requestId} />;
  }

  const job = loaded.value;
  const declined = declinedTheFit(job, queued);
  const items = declined ? job.checklist_if_declined : job.checklist;
  const all = items.length > 0 && done.length === items.length;

  return (
    <StepFrame
      title={titleOf(job, declined)}
      at={done.length}
      of={items.length}
      action={copy.next}
      ready={all}
      unfinished={copy.checklist.unfinished}
      notice={refused === null ? null : copy.corrected.other}
      onBack={back}
      onAction={() => void finish({ done: [...done] })}
    >
      <ul className={styles.list}>
        {items.map((item) => {
          const ticked = done.includes(item.id);
          return (
            <li key={item.id}>
              <button
                className={styles.check}
                type="button"
                aria-pressed={ticked}
                onClick={() => {
                  setDone((already) =>
                    already.includes(item.id) ? already.filter((one) => one !== item.id) : [...already, item.id],
                  );
                }}
              >
                <span className={ticked ? styles.boxDone : styles.box}>
                  {ticked && <Icon d={GLYPHS.check} size={22} stroke={BOX_TICK_STROKE} />}
                </span>
                <span className={ticked ? styles.checkDone : styles.checkLabel}>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}
