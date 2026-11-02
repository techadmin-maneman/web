// Today's homes by a person's grants (apps/ops/src/today/homes.ts, ADR 0227): which they are offered, which opens first,
// and which home lists each kind of task under Needs you, so nothing on their board goes unseen.

import { describe, expect, it } from "vitest";
import type { Whoami } from "../../../../../apps/ops/src/api.ts";
import { HOMES, homeLists, homesOf } from "../../../../../apps/ops/src/today/homes.ts";

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

describe("the homes a person is offered", () => {
  it("are every home while the Staff list is not enforced", () => {
    expect(homesOf(staff([], false))).toEqual(HOMES);
  });

  it("are Dispatch and Inventory for operations, Care for Customer Care and Finance for finance", () => {
    expect(homesOf(staff([grant("operations")]))).toEqual(["dispatch", "inventory"]);
    expect(homesOf(staff([grant("customer_care")]))).toEqual(["care"]);
    expect(homesOf(staff([grant("finance")]))).toEqual(["finance"]);
    expect(homesOf(staff([grant("operations"), grant("finance")]))).toEqual(["dispatch", "finance", "inventory"]);
  });

  it("open on the City head's for a person whose every grant is in one city", () => {
    expect(homesOf(staff([grant("operations", "Gurgaon"), grant("finance", "Gurgaon")]))).toEqual([
      "city",
      "dispatch",
      "finance",
      "inventory",
    ]);
    expect(homesOf(staff([grant("operations", "Gurgaon"), grant("operations", "Delhi")]))).toEqual([
      "dispatch",
      "inventory",
    ]);
    expect(homesOf(staff([grant("operations", "Gurgaon"), grant("finance")]))).toEqual([
      "dispatch",
      "finance",
      "inventory",
    ]);
  });

  it("are Dispatch alone for Growth or Admin", () => {
    expect(homesOf(staff([grant("growth")]))).toEqual(["dispatch"]);
    expect(homesOf(staff([grant("admin")]))).toEqual(["dispatch"]);
  });
});

describe("which home lists a task", () => {
  const all = HOMES;

  it("is the home of the department that decides it, stock's on Inventory and the rest of operations on Dispatch", () => {
    expect(homeLists("dispatch", all, "unassigned_visit")).toBe(true);
    expect(homeLists("inventory", all, "unassigned_visit")).toBe(false);
    expect(homeLists("inventory", all, "stock_at_risk")).toBe(true);
    expect(homeLists("dispatch", all, "stock_at_risk")).toBe(false);
    expect(homeLists("care", all, "unanswered_chat")).toBe(true);
    expect(homeLists("finance", all, "upi_due")).toBe(true);
    expect(homeLists("finance", all, "unanswered_chat")).toBe(false);
  });

  it("is every task on the City head's", () => {
    expect(homeLists("city", all, "upi_due")).toBe(true);
    expect(homeLists("city", all, "stock_at_risk")).toBe(true);
  });

  it("is the person's first home for a task none of their homes lists", () => {
    expect(homeLists("dispatch", ["dispatch"], "referral_review")).toBe(true);
    expect(homeLists("care", ["care", "finance"], "referral_review")).toBe(true);
    expect(homeLists("finance", ["care", "finance"], "referral_review")).toBe(false);
    expect(homeLists("dispatch", all, "referral_review")).toBe(false);
    expect(homeLists("city", all, "referral_review")).toBe(true);
  });
});
