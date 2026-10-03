// A record one of our own scripts made, named by the rule's own words (src/policy/staging-test-records.ts).

import { describe, expect, it } from "vitest";
import { firstNameOf } from "../../src/lib/names.ts";
import { isStagingTestRecord, RULES, withoutTestMark } from "../../src/policy/staging-test-records.ts";

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

  // CP-24: every test record's first name was "Staging", so a staging invite read "Staging sent you this".
  it(RULES[2], () => {
    expect(withoutTestMark("Staging test Asha Verma")).toBe("Asha Verma");
    expect(withoutTestMark("Load test  friend")).toBe("friend");
    expect(firstNameOf("Staging test Arjun Mehta")).toBe("Arjun");
    expect(firstNameOf("  Staging test Asha ")).toBe("Asha");
  });

  it("keeps a name that is only the mark, and every real name, as it is", () => {
    expect(firstNameOf("Staging test")).toBe("Staging");
    for (const name of ["Arjun Mehta", "Staging testimonial", "Load testing centre"]) {
      expect(withoutTestMark(name), name).toBe(name);
    }
    expect(firstNameOf("Rohit Malhotra")).toBe("Rohit");
  });
});
