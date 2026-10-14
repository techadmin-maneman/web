// The booking pages' flow (site/src/islands/invite/flow.ts): where each thing the visitor does takes the page, and
// what Back and Forward and a reload show.

import { describe, expect, it } from "vitest";
import type { Booking, Listing } from "../../../site/src/islands/invite/outcomes.ts";
import { flow, holdsConfirmation, OPENED, type FlowEvent } from "../../../site/src/islands/invite/flow.ts";

const PERSON = { name: "Karan Bhatia", mobile: "98100 00002", consent: true };
const BOOKING: Booking = {
  result: {
    state: "booked",
    date: "2026-10-16",
    window: "morning",
    area: "Sector 65",
    credits: false,
    invite: "valid",
    one_visit: false,
  },
  mobile: "98100 00002",
  code: null,
};
const LISTING: Listing = { area: "Bandra", credits: false, invite: "valid", pincode: "400050", alerted: true };

const after = (...events: FlowEvent[]) => events.reduce(flow, OPENED);

describe("the booking pages' flow", () => {
  it("opens at the start, asking for the consultation", () => {
    expect(OPENED).toMatchObject({ view: "arrival", step: "start", kept: null, plan: "consultation" });
  });

  it("keeps /book’s name and number, then goes on to the pincode, the visit and the address", () => {
    const kept = after({ type: "kept", person: PERSON });
    expect(kept).toMatchObject({ step: "pincode", kept: PERSON });
    expect(after({ type: "kept", person: PERSON }, { type: "stepped", step: "address" }).step).toBe("address");
  });

  it("keeps the plan chosen whatever step the page moves to", () => {
    const state = after({ type: "planChosen", plan: "one_visit" }, { type: "historyMoved", step: "pincode" });
    expect(state.plan).toBe("one_visit");
  });

  it("shows the confirmation once booked or listed, and only the newest", () => {
    const booked = after({ type: "booked", booking: BOOKING });
    expect(booked).toMatchObject({ view: "booked", booked: BOOKING, listed: null });
    const listed = flow(booked, { type: "listed", listing: LISTING });
    expect(listed).toMatchObject({ view: "listed", listed: LISTING, booked: null });
  });

  it("goes Back from the confirmation to the form, and Forward to the confirmation again", () => {
    const booked = after({ type: "kept", person: PERSON }, { type: "booked", booking: BOOKING });
    const back = flow(booked, { type: "historyMoved", step: "address" });
    expect(back).toMatchObject({ view: "arrival", step: "address", booked: BOOKING });
    expect(flow(back, { type: "historyMoved", step: "done" }).view).toBe("booked");
  });

  // A reload forgets the confirmation, so its history entry opens the form again.
  it("opens the form for a confirmation’s entry it no longer holds", () => {
    expect(holdsConfirmation(OPENED, "done")).toBe(false);
    expect(after({ type: "historyMoved", step: "done" })).toMatchObject({ view: "arrival", step: "form" });
  });

  it("resumes a reloaded step with the name and number the tab kept, and keeps its own where the tab has none", () => {
    expect(after({ type: "resumed", step: "form", person: PERSON })).toMatchObject({ step: "form", kept: PERSON });
    const kept = after({ type: "kept", person: PERSON }, { type: "resumed", step: "address", person: null });
    expect(kept.kept).toEqual(PERSON);
  });
});
