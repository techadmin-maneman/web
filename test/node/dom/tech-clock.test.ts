// The technician app on a phone whose clock is wrong: the day it works, its waits and its close-out are the API's
// (packages/web-kit/clock.ts), and the phone keeps the difference for an open with no signal (apps/tech/src/store/device.ts).

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiNow, startFrom } from "../../../packages/web-kit/clock.ts";
import { todayInIndia } from "../../../apps/tech/src/lib/when.ts";
import { deviceRecord, wipe } from "../../../apps/tech/src/store/db.ts";
import { heardClock, startFromKeptClock } from "../../../apps/tech/src/store/device.ts";

/** 11:00 pm on 14 Oct in India, by the API's clock. */
const API_SAYS = Date.parse("2026-10-14T17:30:00.000Z");
const THREE_HOURS = 3 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  startFrom(0);
});

afterEach(async () => {
  vi.useRealTimers();
  await wipe();
});

describe("a phone three hours fast", () => {
  beforeEach(() => {
    vi.setSystemTime(API_SAYS + THREE_HOURS);
  });

  it("works the API's day, not the phone's", async () => {
    expect(todayInIndia()).toBe("2026-10-15");
    await heardClock(new Date(API_SAYS).toUTCString());
    expect(todayInIndia()).toBe("2026-10-14");
    expect(Math.abs(apiNow() - API_SAYS)).toBeLessThan(1000);
  });

  it("opens with no signal on the API's day, from the difference it kept", async () => {
    await heardClock(new Date(API_SAYS).toUTCString());

    // The app closed and opened again in a basement: nothing has answered yet.
    startFrom(0);
    expect(todayInIndia()).toBe("2026-10-15");
    await startFromKeptClock();
    expect(todayInIndia()).toBe("2026-10-14");
  });
});

it("keeps nothing for a phone within a couple of seconds of the API", async () => {
  vi.setSystemTime(API_SAYS + 500);
  await heardClock(new Date(API_SAYS).toUTCString());
  expect(await deviceRecord("clock")).toBeNull();
});
