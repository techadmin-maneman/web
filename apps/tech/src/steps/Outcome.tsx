// Board B4, step 6: Done, or Partial with a reason. The reasons are the API's
// four (src/config/job-sheet.ts); the app names them and invents none.
//
// The duration runs from Start job to here, and the technician never types a
// time: the phone records the instant this screen's action was taken
// (apps/tech/src/store/jobs.ts).

import { useState } from "react";
import type { PartialReason } from "../api.ts";
import { job as jobCopy, steps as copy } from "../content.ts";
import { Failed, Loading } from "../states/States.tsx";
import { StepFrame } from "./StepFrame.tsx";
import { useStep } from "./useStep.ts";
import styles from "./steps.module.css";

export function Outcome({ id }: { id: string }) {
  const { loaded, retry, finish, back } = useStep(id, "outcome");
  const [partial, setPartial] = useState(false);
  const [reason, setReason] = useState<PartialReason | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const reasons = loaded.value.partial_reasons;
  const ready = !partial || reason !== null;

  return (
    <StepFrame
      title={copy.titles.outcome}
      action={copy.next}
      ready={ready}
      onBack={back}
      onAction={() => void finish(partial && reason !== null ? { outcome: "partial", reason } : { outcome: "done" })}
    >
      <div className={styles.choices}>
        <button
          className={partial ? styles.choice : styles.choiceOn}
          type="button"
          aria-pressed={!partial}
          onClick={() => {
            setPartial(false);
            setReason(null);
          }}
        >
          {copy.outcome.done}
        </button>
        <button
          className={partial ? styles.choiceOn : styles.choice}
          type="button"
          aria-pressed={partial}
          onClick={() => {
            setPartial(true);
          }}
        >
          {copy.outcome.partial}
        </button>
      </div>

      {partial && (
        <ul className={styles.reasons}>
          {reasons.map((one) => (
            <li key={one}>
              <button
                className={reason === one ? styles.reasonOn : styles.reason}
                type="button"
                aria-pressed={reason === one}
                onClick={() => {
                  setReason(one);
                }}
              >
                {copy.outcome.reasons[one]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </StepFrame>
  );
}
