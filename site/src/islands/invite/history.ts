// Each step of the page is an entry in the browser's history, at the same address, so Back returns to the step
// before rather than leaving the page and everything typed on it. A reload keeps the entries, and the name and number
// /book's first step kept are this tab's own note, so a reload resumes where it was.

import type { PincodeAnswer } from "../../lib/api.ts";
import { stepOf, type Step, type StepEntry } from "./step.ts";
import type { PersonFields } from "./person.ts";

/** The tab's note of the name and number, which ends with the tab and goes once the visit is booked. */
const PERSON = "mm_book_person";

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

/** A reloaded page with nothing to resume from opens where it always does, so the entry it reloaded says so too. */
export function startAtTheStart(): void {
  if (currentStep() !== "start") history.replaceState(null, "");
}

function isPerson(value: unknown): value is PersonFields {
  if (typeof value !== "object" || value === null) return false;
  const person = value as Record<string, unknown>;
  return typeof person.name === "string" && typeof person.mobile === "string" && person.consent === true;
}

function keptPerson(): PersonFields | null {
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(PERSON) ?? "null");
    return isPerson(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** Where a reload resumes: the step the history holds, and the name and number its first step kept. */
export function resumed(): { readonly entry: StepEntry; readonly person: PersonFields | null } {
  return { entry: stepOf(history.state), person: keptPerson() };
}

/** Keeps the name and number for a reload in this tab; null forgets them. */
export function keepForReload(person: PersonFields | null): void {
  try {
    if (person === null) sessionStorage.removeItem(PERSON);
    else sessionStorage.setItem(PERSON, JSON.stringify(person));
  } catch {
    // A browser that keeps nothing starts a reload at the start.
  }
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
