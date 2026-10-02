// The page's steps, as an entry in the browser's history holds them (history.ts).

import type { PincodeAnswer } from "../../lib/api.ts";

/** The pincode field, the form its answer opened, or the confirmation. */
export type Step = "pincode" | "form" | "done";

export interface StepEntry {
  readonly step: Step;
  /** The pincode's answer the step was reached with; null at the pincode field. */
  readonly answer: PincodeAnswer | null;
}

const AT_PINCODE: StepEntry = { step: "pincode", answer: null };

function isPincodeAnswer(value: unknown): value is PincodeAnswer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.pincode === "string" && typeof answer.served === "boolean";
}

/** The step a history entry holds. An entry the page did not write is the pincode field. */
export function stepOf(state: unknown): StepEntry {
  if (typeof state !== "object" || state === null) return AT_PINCODE;
  const entry = state as Record<string, unknown>;
  if (entry.step !== "form" && entry.step !== "done") return AT_PINCODE;
  if (!isPincodeAnswer(entry.answer)) return AT_PINCODE;
  return { step: entry.step, answer: entry.answer };
}
