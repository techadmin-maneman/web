// What stands in the way of erasing an account (src/policy/account-deletion.ts,
// docs/decisions/0065-erasure-all-or-nothing.md).

import { describe, expect, it } from "vitest";
import { erasureRefusal, LIVE_VISIT_STATUSES } from "../../src/policy/account-deletion.ts";

describe("account deletion", () => {
  it("is not done while a visit of theirs is still to happen, or a payment is held with no visit behind it", () => {
    expect(erasureRefusal({ visits: [], payments: [] })).toBeNull();
    expect(erasureRefusal({ visits: ["visit"], payments: [] })).toBe("visit_booked");
    expect(erasureRefusal({ visits: [], payments: ["payment"] })).toBe("payment_held");
  });

  it("names the booked visit first, since cancelling it settles its payment too", () => {
    expect(erasureRefusal({ visits: ["visit"], payments: ["payment"] })).toBe("visit_booked");
  });

  it("counts a visit as still to happen until FSM has closed it", () => {
    expect(LIVE_VISIT_STATUSES).toEqual(["scheduled", "dispatched", "in_progress"]);
  });
});
