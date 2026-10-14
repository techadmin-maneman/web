// What the booking pages show, as one state each thing the visitor does moves on: the step the page is at, the name
// and number /book kept first, the plan chosen, and the confirmation once there is one. The browser's history and the
// forms' requests are the island's (./usePageFlow.ts); this says only where they lead. Like the try-on's
// (../tryon/machine.ts), it is tested on its own (test/node/site/booking-flow.test.ts).

import type { OpenWindows } from "../../lib/api.ts";
import type { Booking, Listing } from "./outcomes.ts";
import type { Step } from "./step.ts";
import type { PersonFields } from "./person.ts";

/** What the form books: the free consultation alone, or the consultation and fit in one visit. */
export type Plan = OpenWindows["plan"];

export interface Flow {
  readonly view: "arrival" | "booked" | "listed";
  readonly step: Step;
  /** On /book, the name and number its first step kept. */
  readonly kept: PersonFields | null;
  /** Kept here rather than in the form, so the page's heading follows it and a changed pincode keeps it. */
  readonly plan: Plan;
  readonly booked: Booking | null;
  readonly listed: Listing | null;
}

export type FlowEvent =
  | { readonly type: "kept"; readonly person: PersonFields }
  | { readonly type: "stepped"; readonly step: Step }
  | { readonly type: "planChosen"; readonly plan: Plan }
  | { readonly type: "booked"; readonly booking: Booking }
  | { readonly type: "listed"; readonly listing: Listing }
  /** Back or Forward landed on a step. */
  | { readonly type: "historyMoved"; readonly step: Step }
  /** A reload resumed a step, with the name and number /book kept in the tab. */
  | { readonly type: "resumed"; readonly step: Step; readonly person: PersonFields | null };

export const OPENED: Flow = {
  view: "arrival",
  step: "start",
  kept: null,
  plan: "consultation",
  booked: null,
  listed: null,
};

/** Whether the history's step is a confirmation this page still holds, which shows again; a reload holds none. */
export function holdsConfirmation(state: Flow, step: Step): boolean {
  return step === "done" && (state.booked !== null || state.listed !== null);
}

export function flow(state: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case "kept":
      return { ...state, kept: event.person, step: "pincode" };
    case "stepped":
      return { ...state, step: event.step };
    case "planChosen":
      return { ...state, plan: event.plan };
    case "booked":
      return { ...state, view: "booked", booked: event.booking, listed: null };
    case "listed":
      return { ...state, view: "listed", listed: event.listing, booked: null };
    case "historyMoved":
      if (holdsConfirmation(state, event.step)) return { ...state, view: state.booked === null ? "listed" : "booked" };
      return { ...state, view: "arrival", step: event.step === "done" ? "form" : event.step };
    case "resumed":
      return { ...state, step: event.step, kept: event.person ?? state.kept };
  }
}
