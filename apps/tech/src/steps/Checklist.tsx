// Board B2, step 2: the service checklist. One 88 px row per item, a 36 px box
// each, and the action dim until the list is finished.
//
// The items are the API's, per visit type (src/config/job-sheet.ts); the app
// invents none and sends back the IDs it was given.

import { useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { steps as copy } from "../content.ts";
import { TICK } from "../icons.ts";
import { Failed, Loading } from "../states/States.tsx";
import { job as jobCopy } from "../content.ts";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

export function Checklist({ id }: { id: string }) {
  const { loaded, retry, at, of, finish, back } = useStep(id, "checklist");
  const [done, setDone] = useState<readonly string[]>([]);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const items = loaded.value.checklist;
  const all = items.length > 0 && done.length === items.length;

  return (
    <StepFrame
      title={copy.titles.checklist}
      at={at}
      of={of}
      action={copy.next}
      ready={all}
      unfinished={copy.checklist.unfinished}
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
                <span className={ticked ? styles.boxDone : styles.box}>{ticked && <Icon d={TICK} size={22} />}</span>
                <span className={ticked ? styles.checkDone : styles.checkLabel}>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}
