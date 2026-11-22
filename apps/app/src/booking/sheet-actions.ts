// The booking sheet's own actions (./BookingSheet.tsx): holding the start chosen, and stepping back.

import { api, type Hold, type Wanted } from "../api.ts";
import { booking } from "../content.ts";
import type { BookingEvent } from "./flow.ts";
import type { Days } from "./useDays.ts";

/**
 * Holding the start chosen, and what is said when it cannot be: taken, no address, not served, made to order, or held
 * too often this hour.
 */
export function useHoldStart(sheet: {
  once: (work: () => Promise<void>) => Promise<void>;
  wanted: Wanted | null;
  days: Days;
  movingId: string | undefined;
  setProblem: (problem: string | null) => void;
  dispatch: (event: BookingEvent) => void;
  askForAddress: (refused: boolean) => void;
  showNotServed: () => void;
}) {
  const { wanted, days } = sheet;
  return () =>
    sheet.once(async () => {
      const { date, chosenStart } = days;
      if (wanted === null || date === null || chosenStart === null) return;
      sheet.setProblem(null);
      const answer = await api.hold(wanted, date, chosenStart, sheet.movingId);
      if (answer.ok) sheet.dispatch({ kind: "held", hold: answer.body });
      else if (answer.code === "taken") {
        sheet.setProblem(booking.when.gone);
        await days.askAgainFrom(wanted, date, chosenStart);
      } else if (answer.code === "address_required") sheet.askForAddress(true);
      else if (answer.code === "not_served") sheet.showNotServed();
      else if (answer.code === "made_to_order") sheet.dispatch({ kind: "madeToOrder" });
      else if (answer.code === "rate_limited") sheet.setProblem(booking.heldTooOften);
      else sheet.setProblem(booking.failedToStart);
    });
}

/**
 * Stepping back, from the day and time to the service, or from the review, back or to change the address, which lets
 * the time held go for someone else; either way what went wrong on the step left is no longer said.
 */
export function stepsBack(sheet: {
  letGo: (hold: Hold) => void;
  setProblem: (problem: string | null) => void;
  dispatch: (event: BookingEvent) => void;
}) {
  return {
    leaveReview: (hold: Hold, event: BookingEvent) => {
      sheet.letGo(hold);
      sheet.setProblem(null);
      sheet.dispatch(event);
    },
    stepBack: () => {
      sheet.setProblem(null);
      sheet.dispatch({ kind: "back" });
    },
  };
}
