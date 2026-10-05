// What stands in the way of erasing an account (src/policy/account-deletion.ts,
// docs/decisions/0066-erasure-all-or-nothing.md).

import { describe, expect, it } from "vitest";
import { DELETION_ALERT_AFTER_MS } from "../../../src/domain/deletion.ts";
import { DAY_MS } from "../../../src/lib/durations.ts";
import {
  DELETION_DECIDED_WITHIN_DAYS,
  erasureRefusal,
  LIVE_VISIT_STATUSES,
} from "../../../src/policy/account-deletion.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";

describe("account deletion", () => {
  it("decides a deletion within 7 days, the task due then, and alerts before it is", () => {
    // The 7 days run from the client's request to ops' decision (docs/decisions/0049-dpdp.md), and the erasure
    // that decision makes deletes the photographs at once.
    expect(DELETION_DECIDED_WITHIN_DAYS).toBe(7);
    expect(TASK_SLA_HOURS.erasure_request).toBe(DELETION_DECIDED_WITHIN_DAYS * 24);
    expect(DELETION_ALERT_AFTER_MS).toBeLessThan(DELETION_DECIDED_WITHIN_DAYS * DAY_MS);
  });

  const nothing = { visits: [], bookings: [], payments: [], links: [] };

  it("is not done while a visit or booking of theirs is still to happen, a payment is held, or a link is unpaid", () => {
    expect(erasureRefusal(nothing)).toBeNull();
    expect(erasureRefusal({ ...nothing, visits: ["visit"] })).toBe("visit_booked");
    expect(erasureRefusal({ ...nothing, bookings: ["booking"] })).toBe("visit_booked");
    expect(erasureRefusal({ ...nothing, payments: ["payment"] })).toBe("payment_held");
    expect(erasureRefusal({ ...nothing, links: ["link"] })).toBe("payment_owed");
  });

  it("names the booked visit first, since cancelling it settles its payment too", () => {
    expect(erasureRefusal({ ...nothing, visits: ["visit"], payments: ["payment"] })).toBe("visit_booked");
    expect(erasureRefusal({ ...nothing, bookings: ["booking"], links: ["link"] })).toBe("visit_booked");
    expect(erasureRefusal({ ...nothing, payments: ["payment"], links: ["link"] })).toBe("payment_held");
  });

  it("counts a visit as still to happen until FSM has closed it", () => {
    expect(LIVE_VISIT_STATUSES).toEqual(["scheduled", "dispatched", "in_progress"]);
  });
});
