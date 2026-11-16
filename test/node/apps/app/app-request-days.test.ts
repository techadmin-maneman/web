// The days Ask for a time offers (apps/app/src/booking/request-days.ts): a fortnight from tomorrow, or from the first
// day the visit may be booked where that is later, as a replacement's month; and on to a day the app offered further out.

import { describe, expect, it } from "vitest";
import { requestDays } from "../../../../apps/app/src/booking/request-days.ts";

describe("the days Ask for a time offers", () => {
  it("are tomorrow and the thirteen days after it", () => {
    const days = requestDays("2026-11-05", undefined, undefined);
    expect(days).toHaveLength(14);
    expect([days[0], days.at(-1)]).toEqual(["2026-11-06", "2026-11-19"]);
  });

  it("start on the first day a replacement may be booked, never on a day it is refused", () => {
    const days = requestDays("2026-11-05", "2026-12-01", undefined);
    expect([days[0], days.at(-1)]).toEqual(["2026-12-01", "2026-12-14"]);
  });

  it("start tomorrow where the first bookable day has passed", () => {
    expect(requestDays("2026-11-05", "2026-11-01", undefined)[0]).toBe("2026-11-06");
  });

  it("run on to the day the app offered, where that is further than a fortnight", () => {
    expect(requestDays("2026-11-05", undefined, "2026-11-30").at(-1)).toBe("2026-11-30");
  });
});
