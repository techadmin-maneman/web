// Board B2, step 2: the visit's checklist. One 88 px row per item, a 36 px box
// each, and the action dim until the list is finished.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given. The title names the visit
// the list is for: the board titles a service visit's.

import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { job as jobCopy, steps as copy } from "../content.ts";
import { BOX_TICK, BOX_TICK_STROKE } from "../icons.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

export function Checklist({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "checklist");
  const [done, setDone] = useState<readonly string[]>([]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const job = loaded.value;
  const items = job.checklist;
  const all = items.length > 0 && done.length === items.length;

  return (
    <StepFrame
      title={job.type === null ? copy.titles.checklist : copy.checklistTitles[job.type]}
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
                  {ticked && <Icon d={BOX_TICK} size={22} stroke={BOX_TICK_STROKE} />}
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
