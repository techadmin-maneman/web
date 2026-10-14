// Where a reload and the browser's Back and Forward take the page, from the steps it wrote to the history (history.ts).

import { useEffect } from "preact/hooks";
import type { PincodeAnswer } from "../../lib/api.ts";
import { useLatest } from "../useLatest.ts";
import { onStepChange, resumed, startAtTheStart } from "./history.ts";
import type { Step } from "./step.ts";
import type { PersonFields } from "./useTurnstileForm.ts";

/** What the page opens: a step with the pincode's answer it was reached with, or the confirmation it holds. */
export interface StepShown {
  readonly step: (step: Exclude<Step, "done">, answer: PincodeAnswer | null) => void;
  readonly confirmation: () => boolean;
  readonly person: (person: PersonFields) => void;
}

/**
 * A reload resumes the step it was on, with /book's name and number from this tab's note; without them it starts.
 * Back and Forward move between the steps; a confirmation shows again only while this page holds it.
 */
export function useStepHistory(invited: boolean, show: StepShown): void {
  const latest = useLatest(show);

  useEffect(() => {
    const { entry, person } = resumed();
    if (entry.step === "start" || entry.step === "done" || (!invited && person === null)) {
      startAtTheStart();
      return;
    }
    if (person !== null && !invited) latest.current.person(person);
    latest.current.step(entry.step, entry.answer);
  }, [invited, latest]);

  useEffect(
    () =>
      onStepChange((entry) => {
        if (entry.step === "done" && latest.current.confirmation()) return;
        latest.current.step(entry.step === "done" ? "form" : entry.step, entry.answer);
      }),
    [latest],
  );
}
