// The status sets the queries ask about, written into SQL (src/config/statuses.ts).

import { describe, expect, it } from "vitest";
import { PAYMENT_HELD, statusIn, statusNotIn, VISIT_CALLED_OFF, VISIT_LIVE } from "../../../src/config/statuses.ts";

describe("a status set in SQL", () => {
  it("lists each status quoted, in the set's order", () => {
    expect(statusIn("a.status", VISIT_LIVE)).toBe("a.status IN ('scheduled', 'dispatched', 'in_progress')");
    expect(statusIn("status", PAYMENT_HELD)).toBe("status IN ('captured', 'partially_refunded')");
  });

  it("can ask for a status outside the set", () => {
    expect(statusNotIn("later.status", VISIT_CALLED_OFF)).toBe("later.status NOT IN ('cancelled', 'terminated')");
  });
});
