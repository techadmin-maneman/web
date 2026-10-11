// Each step of the page is an entry in the browser's history, at the same address, so Back returns to the step
// before rather than leaving the page and everything typed on it.

import type { PincodeAnswer } from "../../lib/api.ts";
import { stepOf, type Step, type StepEntry } from "./step.ts";

export function currentStep(): Step {
  return stepOf(history.state).step;
}

/** /book's pincode field, once the name and number are kept; or a step the pincode's answer opened. */
export function pushStep(step: "pincode", answer: null): void;
export function pushStep(step: "form" | "address" | "done", answer: PincodeAnswer): void;
export function pushStep(step: Exclude<Step, "start">, answer: PincodeAnswer | null): void {
  const entry: StepEntry = { step, answer };
  history.pushState(entry, "");
}

/** A reloaded page opens where it always does, so the entry it reloaded says so too. */
export function startAtTheStart(): void {
  if (currentStep() !== "start") history.replaceState(null, "");
}

/** Calls `onStep` with each step Back or Forward lands on; returns what stops it. */
export function onStepChange(onStep: (entry: StepEntry) => void): () => void {
  const listener = (event: PopStateEvent) => {
    onStep(stepOf(event.state));
  };
  addEventListener("popstate", listener);
  return () => {
    removeEventListener("popstate", listener);
  };
}
