// What stands in the way of erasing an account (src/policy/account-deletion.ts,
// docs/decisions/0066-erasure-all-or-nothing.md).

import { describe, expect, it } from "vitest";
import { DELETION_ALERT_AFTER_MS } from "../../src/domain/deletion.ts";
import { DAY_MS } from "../../src/lib/durations.ts";
import {
  DELETION_DECIDED_WITHIN_DAYS,
  erasureRefusal,
  LIVE_VISIT_STATUSES,
  RULES,
} from "../../src/policy/account-deletion.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";

describe("account deletion", () => {
  it(RULES[0], () => {
    // The 7 days run from the client's request to ops' decision (docs/decisions/0049-dpdp.md), and the erasure
    // that decision makes deletes the photographs at once.
    expect(DELETION_DECIDED_WITHIN_DAYS).toBe(7);
    expect(TASK_SLA_HOURS.erasure_request).toBe(DELETION_DECIDED_WITHIN_DAYS * 24);
    expect(DELETION_ALERT_AFTER_MS).toBeLessThan(DELETION_DECIDED_WITHIN_DAYS * DAY_MS);
  });

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
