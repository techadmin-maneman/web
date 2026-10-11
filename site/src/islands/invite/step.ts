// The page's steps, as an entry in the browser's history holds them (history.ts).

import type { PincodeAnswer } from "../../lib/api.ts";

/**
 * Where the page opens, then the steps after it. The invite's page opens at the pincode field; /book opens at the
 * name and number, and has its pincode field next (docs/decisions/0116-book-asks-for-the-name-and-number-first.md).
 * Then the form the pincode's answer opened, which /book splits into the visit and the address, and the confirmation.
 */
export type Step = "start" | "pincode" | "form" | "address" | "done";

export interface StepEntry {
  readonly step: Step;
  /** The pincode's answer the step was reached with; null before the pincode has one. */
  readonly answer: PincodeAnswer | null;
}

const AT_START: StepEntry = { step: "start", answer: null };

function isPincodeAnswer(value: unknown): value is PincodeAnswer {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.pincode === "string" && typeof answer.served === "boolean";
}

/** The step a history entry holds. An entry the page did not write is where it opens. */
export function stepOf(state: unknown): StepEntry {
  if (typeof state !== "object" || state === null) return AT_START;
  const entry = state as Record<string, unknown>;
  if (entry.step === "pincode") return { step: "pincode", answer: null };
  if (entry.step !== "form" && entry.step !== "address" && entry.step !== "done") return AT_START;
  if (!isPincodeAnswer(entry.answer)) return AT_START;
  return { step: entry.step, answer: entry.answer };
}
