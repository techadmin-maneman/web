// A record one of our own scripts made, named by the rule's own words (src/policy/staging-test-records.ts).

import { describe, expect, it } from "vitest";
import { firstNameOf } from "../../src/lib/names.ts";
import { isStagingTestName, withoutTestMark } from "../../src/lib/test-names.ts";
import { RULES, testRecordAtCreation } from "../../src/policy/staging-test-records.ts";

describe("a staging test record", () => {
  it(RULES[0], () => {
    for (const name of ["Staging test", "Load test", "Staging test technician", "Load test friend"]) {
      expect(isStagingTestName(name), name).toBe(true);
    }
  });

  // The owner's decision 23: the mark is stored when a record is made, on staging alone.
  it("is marked when made on staging with a test name, and never elsewhere", () => {
    expect(testRecordAtCreation("staging", "Staging test Asha")).toBe(true);
    expect(testRecordAtCreation("staging", "Asha Verma")).toBe(false);
    expect(testRecordAtCreation("production", "Staging test Asha")).toBe(false);
    expect(testRecordAtCreation("local", "Staging test Asha")).toBe(false);
  });

  it("is never a real person's or technician's name", () => {
    for (const name of ["Arjun Mehta", "Load", "Staging", "Load testing centre", "Staging testimonial"]) {
      expect(isStagingTestName(name), name).toBe(false);
    }
  });

  // Every test record's first name was "Staging", so a staging invite read "Staging sent you this".
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
