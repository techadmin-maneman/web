// Today's one home for a person, by their grants (apps/ops/src/today/homes.ts, ADR 0227, ADR 0238): everyone has one
// role, so there is no choice between homes.

import { describe, expect, it } from "vitest";
import type { Whoami } from "../../../../../apps/ops/src/api.ts";
import { homeOf } from "../../../../../apps/ops/src/today/homes.ts";

type Grant = Whoami["staff"]["grants"][number];

const staff = (grants: Grant[], enforced = true): Whoami["staff"] => ({
  enforced,
  listed: true,
  grants,
  may_call: [],
});

const grant = (department: Grant["department"], place: string | null = null): Grant => ({
  department,
  level: "act",
  geography: place === null ? "national" : "city",
  place,
});

describe("the home Today opens for a person", () => {
  it("is Dispatch while the Staff list is not enforced, or for a person with no grants", () => {
    expect(homeOf(staff([grant("finance")], false))).toBe("dispatch");
    expect(homeOf(staff([]))).toBe("dispatch");
  });

  it("is Dispatch for operations, Care for Customer Care and Finance for finance", () => {
    expect(homeOf(staff([grant("operations")]))).toBe("dispatch");
    expect(homeOf(staff([grant("customer_care")]))).toBe("care");
    expect(homeOf(staff([grant("finance")]))).toBe("finance");
  });

  it("is the City head's for a person whose every grant is in one city", () => {
    expect(homeOf(staff([grant("operations", "Gurgaon"), grant("finance", "Gurgaon")]))).toBe("city");
    expect(homeOf(staff([grant("operations", "Gurgaon"), grant("operations", "Delhi")]))).toBe("dispatch");
    expect(homeOf(staff([grant("finance", "Gurgaon"), grant("finance")]))).toBe("finance");
  });

  it("is Dispatch for Growth or Admin", () => {
    expect(homeOf(staff([grant("growth")]))).toBe("dispatch");
    expect(homeOf(staff([grant("admin")]))).toBe("dispatch");
  });
});
