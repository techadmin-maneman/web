// The Staff page's grants as the console says them and as its boxes hold them (apps/ops/src/lib/grants.ts).

import { describe, expect, it } from "vitest";
import type { StaffPerson } from "../../../apps/ops/src/api.ts";
import { alreadyListed, grantWords, whereOf, whereValue } from "../../../apps/ops/src/lib/grants.ts";

const LEAD: StaffPerson = {
  email: "noida.lead@maneman.in",
  active: true,
  grants: [{ department: "operations", level: "act", geography: "city", place: "Noida" }],
  added_by: "owner@maneman.in",
  added_at: "2026-10-01T06:30:00.000Z",
  changed_by: null,
  changed_at: null,
};

describe("a grant in the console", () => {
  it("reads as department, level and place", () => {
    expect(grantWords({ department: "finance", level: "manage", geography: "national", place: null })).toBe(
      "Finance · Manage · National",
    );
    expect(grantWords({ department: "customer_care", level: "view", geography: "zone", place: "NCR" })).toBe(
      "Customer Care · View · NCR zone",
    );
  });

  it("keeps its place in one box value and reads it back", () => {
    for (const where of [
      { geography: "national", place: null },
      { geography: "zone", place: "NCR" },
      { geography: "city", place: "Delhi" },
    ] as const) {
      expect(whereOf(whereValue(where))).toEqual(where);
    }
  });
});

describe("adding a person", () => {
  it("finds one already listed, whatever the case or spaces typed, so their grants are not replaced unseen", () => {
    expect(alreadyListed([LEAD], "  Noida.Lead@ManeMan.in ")).toBe(true);
    expect(alreadyListed([LEAD], "delhi.lead@maneman.in")).toBe(false);
  });
});
