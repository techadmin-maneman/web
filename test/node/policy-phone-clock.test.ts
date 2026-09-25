// How far a technician's phone is trusted about time (src/policy/phone-clock.ts):
// the prompt's rules it serves, and our bounds, each named by its own words.

import { describe, expect, it } from "vitest";
import { uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";
import { timeOfUuidV7 } from "../../src/lib/uuidv7.ts";
import {
  boundedPhoneTime,
  BOUNDS,
  EARLIEST_BEFORE_START_MIN,
  MAX_OFFLINE_HOURS,
  onTheVisitsDay,
  RULES,
} from "../../src/policy/phone-clock.ts";

/** A visit booked for 10:00 on Monday 21 September, in India. */
const VISIT_START = new Date("2026-09-21T04:30:00Z");
const minutes = (from: Date, count: number) => new Date(from.getTime() + count * 60_000);

describe("the prompt's offline writes", () => {
  it(RULES[0], () => {
    // The ID a write is sent with is the moment the phone queued it.
    const queued = Date.parse("2026-09-21T04:41:07.123Z");
    expect(timeOfUuidV7(uuidv7(queued))).toEqual(new Date(queued));
    expect(timeOfUuidV7("event-checkin-01")).toBeNull();
    expect(timeOfUuidV7(crypto.randomUUID())).toBeNull();
  });

  it(RULES[1], () => {
    // Closed out in a basement at 11:20 and sent at 11:50: the close keeps 11:20.
    const closed = minutes(VISIT_START, 80);
    expect(boundedPhoneTime(closed, { visitStart: VISIT_START, receivedAt: minutes(VISIT_START, 110) })).toEqual(
      closed,
    );
  });
});

describe("the bounds on the phone's clock", () => {
  it(BOUNDS[0], () => {
    const received = minutes(VISIT_START, 20);
    // A phone whose clock runs ahead, or one set forward by hand.
    expect(boundedPhoneTime(minutes(received, 30), { visitStart: VISIT_START, receivedAt: received })).toEqual(
      received,
    );
  });

  it(BOUNDS[1], () => {
    const received = minutes(VISIT_START, 100);
    // Back-dated to well before the visit: no earlier than the booked start less the margin.
    const backDated = minutes(VISIT_START, -6 * 60);
    expect(boundedPhoneTime(backDated, { visitStart: VISIT_START, receivedAt: received })).toEqual(
      minutes(VISIT_START, -EARLIEST_BEFORE_START_MIN),
    );

    // Held on the phone longer than a phone may hold a write: no earlier than that.
    const lateReceipt = minutes(VISIT_START, (MAX_OFFLINE_HOURS + 5) * 60);
    expect(boundedPhoneTime(minutes(VISIT_START, 10), { visitStart: VISIT_START, receivedAt: lateReceipt })).toEqual(
      minutes(lateReceipt, -MAX_OFFLINE_HOURS * 60),
    );
  });

  it("takes the server's own time when the phone gave none", () => {
    const received = minutes(VISIT_START, 3);
    expect(boundedPhoneTime(null, { visitStart: VISIT_START, receivedAt: received })).toEqual(received);
  });

  it(BOUNDS[2], () => {
    // 11:30 pm the same day in India is still the visit's day; 00:30 the next is not.
    expect(onTheVisitsDay(new Date("2026-09-21T18:00:00Z"), VISIT_START)).toBe(true);
    expect(onTheVisitsDay(new Date("2026-09-21T19:00:00Z"), VISIT_START)).toBe(false);
    // The evening before, when tomorrow's card is already unlocked.
    expect(onTheVisitsDay(new Date("2026-09-20T13:30:00Z"), VISIT_START)).toBe(false);
  });
});
