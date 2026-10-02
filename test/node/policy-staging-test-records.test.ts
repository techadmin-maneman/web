// A record one of our own scripts made, named by the rule's own words (src/policy/staging-test-records.ts).

import { describe, expect, it } from "vitest";
import { isStagingTestRecord, RULES } from "../../src/policy/staging-test-records.ts";

describe("a staging test record", () => {
  it(RULES[0], () => {
    for (const name of ["Staging test", "Load test", "Staging test technician", "Load test friend"]) {
      expect(isStagingTestRecord(name), name).toBe(true);
    }
  });

  it("is never a real person's or technician's name", () => {
    for (const name of ["Arjun Mehta", "Load", "Staging", "Load testing centre", "Staging testimonial"]) {
      expect(isStagingTestRecord(name), name).toBe(false);
    }
  });
});
