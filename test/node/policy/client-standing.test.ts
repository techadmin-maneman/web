// Where a client stands: active through their cadence and its grace, lapsed after, lost once lapsed for the days set.

import { describe, expect, it } from "vitest";
import { standingOn } from "../../../src/policy/client-standing.ts";

const DAYS = { cadence: 30, grace: 7, lostAfter: 90 };

describe("a client's standing", () => {
  it("is active through the day their next service's grace ends", () => {
    expect(standingOn("2026-09-01", "2026-09-01", DAYS)).toBe("active");
    expect(standingOn("2026-10-08", "2026-09-01", DAYS)).toBe("active");
  });

  it("is lapsed from the day after, and lost once lapsed for the days set", () => {
    expect(standingOn("2026-10-09", "2026-09-01", DAYS)).toBe("lapsed");
    expect(standingOn("2027-01-06", "2026-09-01", DAYS)).toBe("lapsed");
    expect(standingOn("2027-01-07", "2026-09-01", DAYS)).toBe("lost");
  });
});
