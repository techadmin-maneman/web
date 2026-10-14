// Where a reload and the browser's Back and Forward take the page, from the steps it wrote to the history (history.ts).

import { useEffect } from "preact/hooks";
import { useLatest } from "../useLatest.ts";
import { onStepChange, resumed, startAtTheStart } from "./history.ts";
import type { StepEntry } from "./step.ts";
import type { PersonFields } from "./useTurnstileForm.ts";

/** What the page does with a step the history gives it. */
export interface StepMoves {
  /** A reload resumed this step, with /book's name and number from this tab's note; null on an invite's page. */
  readonly resumed: (entry: StepEntry, person: PersonFields | null) => void;
  /** Back or Forward landed on this step. */
  readonly moved: (entry: StepEntry) => void;
}

/**
 * A reload resumes the step it was on, with /book's name and number from this tab's note; without them it starts.
 * Back and Forward move between the steps.
 */
export function useStepHistory(invited: boolean, moves: StepMoves): void {
  const latest = useLatest(moves);

  useEffect(() => {
    const { entry, person } = resumed();
    if (entry.step === "start" || entry.step === "done" || (!invited && person === null)) {
      startAtTheStart();
      return;
    }
    latest.current.resumed(entry, invited ? null : person);
  }, [invited, latest]);

  useEffect(
    () =>
      onStepChange((entry) => {
        latest.current.moved(entry);
      }),
    [latest],
  );
}
