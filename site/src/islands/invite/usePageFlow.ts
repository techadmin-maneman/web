// What both booking pages do around their forms (./Landing.tsx, ./Book.tsx): the flow's state (./flow.ts) moved on by
// the forms, the browser's history and a ?state= preview, the pincode's check, and focus taken to what each step
// opens. Each step the page moves on to is written to the history (./history.ts), so Back returns to the one before.

import { useEffect, useReducer, useRef } from "preact/hooks";
import { flow, holdsConfirmation, OPENED, type Plan } from "./flow.ts";
import type { Booking, Listing } from "./outcomes.ts";
import { currentStep, keepForReload, pushStep } from "./history.ts";
import { PREVIEW_PERSON, usePreview } from "./preview.ts";
import type { Step } from "./step.ts";
import { usePincode } from "./usePincode.ts";
import type { PersonFields } from "./useTurnstileForm.ts";
import { useStepHistory } from "./useStepHistory.ts";

/** How far back /book's first step is from each step after it, in the browser's history. */
const BACK_TO_START: Partial<Record<Step, number>> = { pincode: 1, form: 2, address: 3 };

/** `invited` is an invite's page, which asks for everything in one form; /book asks a step at a time. */
export function usePageFlow(invited: boolean, allowStateSwitch: boolean) {
  const [state, dispatch] = useReducer(flow, OPENED);
  const pincode = usePincode();
  const heading = useRef<HTMLHeadingElement>(null);

  usePreview(allowStateSwitch, (preview) => {
    if (preview.kind === "answer") {
      pincode.setAnswer(preview.answer);
      dispatch({ type: "resumed", step: "form", person: PREVIEW_PERSON });
    }
    if (preview.kind === "booked") dispatch({ type: "booked", booking: preview.booking });
    if (preview.kind === "listed") dispatch({ type: "listed", listing: preview.listing });
  });

  useStepHistory(invited, {
    resumed: (entry, person) => {
      dispatch({ type: "resumed", step: entry.step, person });
      pincode.show(entry.answer);
    },
    moved: (entry) => {
      const confirmation = holdsConfirmation(state, entry.step);
      dispatch({ type: "historyMoved", step: entry.step });
      if (!confirmation) pincode.show(entry.answer);
    },
  });

  // /book's pincode field takes focus as its step opens, from the name and number or back from the form.
  useEffect(() => {
    if (state.step === "pincode") pincode.field.current?.focus();
  }, [state.step, pincode.field]);

  useEffect(() => {
    if (state.view !== "arrival") {
      globalThis.scrollTo(0, 0);
      heading.current?.focus();
    }
  }, [state.view]);

  const { answer } = pincode;
  return {
    state,
    pincode,
    heading,
    /** /book's first step kept the name and number: on to the pincode. */
    keepPerson: (person: PersonFields) => {
      dispatch({ type: "kept", person });
      keepForReload(person);
      pushStep("pincode", null);
    },
    /** Back to the name and number, as the browser's Back would go. */
    changePerson: () => {
      // Read from the history, where the pincode's answer writes its own entry (usePincode.ts).
      const back = BACK_TO_START[currentStep()];
      if (back === undefined) dispatch({ type: "stepped", step: "start" });
      else history.go(-back);
    },
    choosePlan: (plan: Plan) => {
      dispatch({ type: "planChosen", plan });
    },
    /** On /book, on from the visit to the address. */
    toAddress: () => {
      if (answer === null) return;
      pushStep("address", answer);
      dispatch({ type: "stepped", step: "address" });
    },
    booked: (booking: Booking) => {
      dispatch({ type: "booked", booking });
      keepForReload(null);
      if (answer !== null) pushStep("done", answer);
    },
    listed: (listing: Listing) => {
      dispatch({ type: "listed", listing });
      keepForReload(null);
      if (answer !== null) pushStep("done", answer);
    },
  };
}

export type PageFlow = ReturnType<typeof usePageFlow>;
