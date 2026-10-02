// Each step of the page is an entry in the browser's history, at the same address, so Back returns to the step
// before rather than leaving the page and everything typed on it.

import type { PincodeAnswer } from "../../lib/api.ts";
import { stepOf, type Step, type StepEntry } from "./step.ts";

export function currentStep(): Step {
  return stepOf(history.state).step;
}

export function pushStep(step: "form" | "done", answer: PincodeAnswer): void {
  const entry: StepEntry = { step, answer };
  history.pushState(entry, "");
}

/** A reloaded page opens at the pincode field, so the entry it reloaded says so too. */
export function startAtPincode(): void {
  if (currentStep() !== "pincode") history.replaceState(null, "");
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
