// Stepping back in the booking sheet (apps/app/src/booking/sheet-actions.ts): from the day and time to the service, or
// from the review, back or to change the address. The time held is let go for someone else, and what went wrong on the
// step left, as a time taken by another client, is no longer said on the next.

import { describe, expect, it } from "vitest";
import type { BookingEvent } from "../../apps/app/src/booking/flow.ts";
import { stepsBack } from "../../apps/app/src/booking/sheet-actions.ts";
import { holdOf } from "./app-holds.ts";

/** The sheet's actions, each one written down in the order it happened. */
function recorded() {
  const done: string[] = [];
  const actions = stepsBack({
    letGo: (hold) => done.push(`let go ${hold.id}`),
    setProblem: (problem) => done.push(`problem ${String(problem)}`),
    dispatch: (event: BookingEvent) => done.push(`step ${event.kind}`),
  });
  return { done, actions };
}

describe("stepping back", () => {
  it("clears the day and time's error on going back to the service, so a new pick starts clean", () => {
    const { done, actions } = recorded();
    actions.stepBack();
    expect(done).toEqual(["problem null", "step back"]);
  });

  it("lets the time held go, and clears its error, on leaving the review", () => {
    const { done, actions } = recorded();
    const hold = holdOf();
    actions.leaveReview(hold, { kind: "back" });
    actions.leaveReview(hold, { kind: "changeAddress" });
    expect(done).toEqual([
      `let go ${hold.id}`,
      "problem null",
      "step back",
      `let go ${hold.id}`,
      "problem null",
      "step changeAddress",
    ]);
  });
});
