// A booking FSM refuses is held, not refunded (src/policy/held-bookings.ts), in the owner's words of 27 September
// 2026. The booking was refused for the fifth time at noon on Monday 21 September, and its visit is on Thursday.

import { describe, expect, it } from "vitest";
import {
  dueAnotherTry,
  FSM_RETRY,
  REFUSALS_BEFORE_HELD,
  retriesEnd,
  RULES,
  TRIES_STOPPED,
} from "../../src/policy/held-bookings.ts";
import { MAX_FSM_SYNC_ATTEMPTS } from "../../src/queues/fsm-sync.ts";

const HELD_AT = new Date("2026-09-21T06:30:00Z");
const VISIT_START = new Date("2026-09-24T06:30:00Z");
const hoursOn = (hours: number) => new Date(HELD_AT.getTime() + hours * 60 * 60 * 1000);
const held = (lastTried: Date, visitStart = VISIT_START) => ({ heldAt: HELD_AT, lastTried, visitStart });

describe("a booking FSM refuses", () => {
  it(RULES[0], () => {
    expect(REFUSALS_BEFORE_HELD).toBe(MAX_FSM_SYNC_ATTEMPTS);
  });

  it(RULES[1], () => {
    expect(REFUSALS_BEFORE_HELD).toBe(5);
    expect(FSM_RETRY).toEqual({ every: 1, for: 24 });
    expect(retriesEnd(HELD_AT)).toEqual(hoursOn(24));
    expect(dueAnotherTry(held(HELD_AT), hoursOn(0.5))).toBe(false);
    expect(dueAnotherTry(held(HELD_AT), hoursOn(1))).toBe(true);
    expect(dueAnotherTry(held(hoursOn(23)), hoursOn(23.9))).toBe(false);
    expect(dueAnotherTry(held(hoursOn(22)), hoursOn(23.9))).toBe(true);
    expect(dueAnotherTry(held(hoursOn(23)), hoursOn(24))).toBe(false);
  });

  it("is not tried again once its visit has begun", () => {
    expect(dueAnotherTry(held(HELD_AT, hoursOn(3)), hoursOn(2))).toBe(true);
    expect(dueAnotherTry(held(hoursOn(2), hoursOn(3)), hoursOn(3))).toBe(false);
  });

  it("is tried as often, and for as long, as ops set", () => {
    const retry = { every: 3, for: 48 };
    expect(retriesEnd(HELD_AT, retry)).toEqual(hoursOn(48));
    expect(dueAnotherTry(held(HELD_AT), hoursOn(2), retry)).toBe(false);
    expect(dueAnotherTry(held(HELD_AT), hoursOn(3), retry)).toBe(true);
    expect(dueAnotherTry(held(hoursOn(40)), hoursOn(47), retry)).toBe(true);
  });

  it("is never tried again once ops stop its tries to book it in FSM by hand, however long they set the tries to run", () => {
    expect(dueAnotherTry(held(TRIES_STOPPED), hoursOn(1))).toBe(false);
    expect(dueAnotherTry(held(TRIES_STOPPED), hoursOn(47), { every: 1, for: 168 })).toBe(false);
  });
});
