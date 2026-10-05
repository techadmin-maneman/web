// The booking sheet's steps (apps/app/src/booking/flow.ts): every way through the sheet, and the answers that come too
// late to move it. Every hold here is made up.

import { describe, expect, it } from "vitest";
import type { components } from "../../apps/app/src/api-schema.ts";
import { holdOf, nextStep, type BookingEvent, type Step } from "../../apps/app/src/booking/flow.ts";

type Address = components["schemas"]["Address"];
type Hold = components["schemas"]["Hold"];

const HOLD = { id: "hold-1", expires_at: "2026-09-21T06:40:00.000Z" } as Hold;
const PAID = { ...HOLD, paid: true } as Hold;
const ADDRESS = { pincode: "400050" } as Address;

/** The step a run of events leads to, from the sheet opening. */
const after = (...events: BookingEvent[]): Step => events.reduce<Step>(nextStep, { kind: "loading" });

describe("the booking sheet's way through", () => {
  it("goes from the days to the window, a hold, Checkout and the visit booked", () => {
    const steps = [
      { kind: "answered", picking: false, addressMissing: false },
      { kind: "dayTaken" },
      { kind: "held", hold: HOLD },
      { kind: "paid", hold: HOLD },
      { kind: "booked", hold: PAID },
    ] as const satisfies readonly BookingEvent[];
    expect(steps.map((_, index) => after(...steps.slice(0, index + 1)).kind)).toEqual([
      "date",
      "window",
      "pay",
      "confirming",
      "confirmed",
    ]);
  });

  it("asks a client with services to pick first, and for their address only once the visit is picked", () => {
    expect(after({ kind: "answered", picking: true, addressMissing: true }).kind).toBe("service");
    const picked = after(
      { kind: "answered", picking: true, addressMissing: true },
      { kind: "asking" },
      { kind: "answered", picking: false, addressMissing: true },
    );
    expect(picked).toEqual({ kind: "address", refused: false });
  });

  it("asks for the address when the API refuses a hold for want of one, and says where it does not come", () => {
    const window = after({ kind: "answered", picking: false, addressMissing: false }, { kind: "dayTaken" });
    expect(nextStep(window, { kind: "addressNeeded", refused: true })).toEqual({ kind: "address", refused: true });
    expect(nextStep(window, { kind: "notServed", address: ADDRESS })).toEqual({ kind: "notServed", address: ADDRESS });
    // With no address known, it cannot say where, and says it failed.
    expect(nextStep(window, { kind: "notServed", address: null })).toEqual({ kind: "broken" });
  });

  it("lets a failed payment be tried again, and a lapsed hold be picked again", () => {
    const failed = after(
      { kind: "answered", picking: false, addressMissing: false },
      { kind: "dayTaken" },
      { kind: "held", hold: HOLD },
      { kind: "payFailed", hold: HOLD },
    );
    expect(failed).toEqual({ kind: "failed", hold: HOLD });
    expect(nextStep(failed, { kind: "paid", hold: HOLD }).kind).toBe("confirming");
    expect(nextStep(failed, { kind: "lapsed" })).toEqual({ kind: "expired" });
    expect(nextStep({ kind: "expired" }, { kind: "asking" })).toEqual({ kind: "loading" });
  });

  it("finds a payment that came in as the countdown ended, and says so", () => {
    const pay: Step = { kind: "pay", hold: HOLD };
    expect(nextStep(pay, { kind: "paid", hold: PAID, paidIn: true })).toEqual({
      kind: "confirming",
      hold: PAID,
      paidIn: true,
    });
  });

  it("ends a wait for the booking as booked, refunded, or still waiting after a minute", () => {
    const confirming: Step = { kind: "confirming", hold: HOLD };
    expect(nextStep(confirming, { kind: "refunded" })).toEqual({ kind: "refunded" });
    expect(nextStep(confirming, { kind: "slow", paid: true })).toEqual({ kind: "slow", paid: true });
  });

  it("shows the hold again with its price, as a code or a credit gone changes it", () => {
    const priced = { ...HOLD, id: "hold-1" };
    expect(nextStep({ kind: "pay", hold: HOLD }, { kind: "held", hold: priced })).toEqual({
      kind: "pay",
      hold: priced,
    });
  });
});

describe("an answer that comes too late", () => {
  it("leaves a booked visit booked, whatever the countdown or a stray poll says", () => {
    const confirmed: Step = { kind: "confirmed", hold: PAID };
    for (const event of [
      { kind: "lapsed" },
      { kind: "payFailed", hold: HOLD },
      { kind: "slow", paid: true },
      { kind: "refunded" },
      { kind: "failed" },
    ] as const) {
      expect(nextStep(confirmed, event)).toBe(confirmed);
    }
  });

  it("never lets a hold's lapse undo a payment already confirming", () => {
    const confirming: Step = { kind: "confirming", hold: HOLD };
    expect(nextStep(confirming, { kind: "lapsed" })).toBe(confirming);
    expect(nextStep(confirming, { kind: "held", hold: HOLD })).toBe(confirming);
  });

  it("drops a poll's answer once the sheet is no longer waiting on one", () => {
    const pay: Step = { kind: "pay", hold: HOLD };
    expect(nextStep(pay, { kind: "booked", hold: PAID })).toBe(pay);
    expect(nextStep({ kind: "date" }, { kind: "answered", picking: false, addressMissing: false })).toEqual({
      kind: "date",
    });
  });

  it("names the hold whose countdown runs only on the steps that wait on the client", () => {
    expect(holdOf({ kind: "pay", hold: HOLD })).toBe(HOLD);
    expect(holdOf({ kind: "failed", hold: HOLD })).toBe(HOLD);
    expect(holdOf({ kind: "confirming", hold: HOLD })).toBeNull();
  });
});
