// Board B4, step 6: Done, or Partial with a reason. The reasons are the API's
// four (src/config/job-sheet.ts); the app names them and invents none.
//
// Nothing is chosen for the technician. The board draws Done already chosen,
// in gold beside a gold Next, which let a gloved tap close a job he had not
// finished; here both are outlined until he picks, and Next stays dim until he
// has (ADR 0025, "The technician boards").
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

type Choice = "done" | "partial" | null;

/** What the dim Next says: what is still to choose. */
function stillToChoose(choice: Choice): string {
  return choice === null ? copy.outcome.choose : copy.outcome.pickReason;
}

export function Outcome({ id }: { id: string }) {
  const { loaded, retry, refused, finish, back } = useStep(id, "outcome");
  const [choice, setChoice] = useState<Choice>(null);
  const [reason, setReason] = useState<PartialReason | null>(null);

  if (loaded.state === "loading") return <Loading />;
  if (loaded.state === "failed") return <Failed message={jobCopy.failed} retry={jobCopy.retry} onRetry={retry} />;

  const reasons = loaded.value.partial_reasons;
  const ready = choice === "done" || (choice === "partial" && reason !== null);

  return (
    <StepFrame
      title={copy.titles.outcome}
      action={copy.next}
      ready={ready}
      unfinished={stillToChoose(choice)}
      notice={refused === null ? null : copy.corrected.other}
      onBack={back}
      onAction={() =>
        void finish(choice === "partial" && reason !== null ? { outcome: "partial", reason } : { outcome: "done" })
      }
    >
      <div className={styles.choices}>
        <button
          className={choice === "done" ? styles.choiceOn : styles.choice}
          type="button"
          aria-pressed={choice === "done"}
          onClick={() => {
            setChoice("done");
            setReason(null);
          }}
        >
          {copy.outcome.done}
        </button>
        <button
          className={choice === "partial" ? styles.choiceOn : styles.choice}
          type="button"
          aria-pressed={choice === "partial"}
          onClick={() => {
            setChoice("partial");
          }}
        >
          {copy.outcome.partial}
        </button>
      </div>

      {choice === "partial" && (
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
