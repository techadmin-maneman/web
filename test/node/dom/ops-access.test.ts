// What the console offers the person signed in (apps/ops/src/lib/access.ts): a button only where the API would let
// its call through, from whoami's routes, and a choice inside a call, as waiving a no-show is, only where their grants
// reach it, by the same rules the API asks it with.

import { describe, expect, it } from "vitest";
import type { Whoami } from "../../../apps/ops/src/api.ts";
import { accessOf, REFUNDING_A_DISPUTE, taskNeed, WAIVING_A_NO_SHOW } from "../../../apps/ops/src/lib/access.ts";

type Staff = Whoami["staff"];
type StaffGrant = Staff["grants"][number];

const national = (department: StaffGrant["department"], level: StaffGrant["level"]): StaffGrant => ({
  department,
  level,
  geography: "national",
  place: null,
});

const enforced = (grants: StaffGrant[], mayCall: string[]): Staff => ({
  enforced: true,
  listed: true,
  grants,
  may_call: mayCall,
});

describe("what the console offers the person signed in", () => {
  it("offers everything while the Staff list is not enforced, as the API refuses nothing then", () => {
    const access = accessOf({ enforced: false, listed: false, grants: [], may_call: [] });
    expect(access.mayCall("POST /api/deletion-requests/{id}/decision")).toBe(true);
    expect(access.reaches(WAIVING_A_NO_SHOW)).toBe(true);
  });

  it("offers a call only where whoami names it among the routes that go ahead for them", () => {
    const access = accessOf(enforced([national("finance", "view")], ["GET /api/no-shows"]));
    expect(access.mayCall("POST /api/no-shows/{id}/decision")).toBe(false);
    expect(access.mayCall("POST /api/prices")).toBe(false);
  });

  it("charges a no-show and upholds a dispute at Finance Act, and waives or refunds only at Finance Manage", () => {
    const act = accessOf(enforced([national("finance", "act")], ["POST /api/no-shows/{id}/decision"]));
    expect(act.mayCall("POST /api/no-shows/{id}/decision")).toBe(true);
    expect(act.reaches(WAIVING_A_NO_SHOW)).toBe(false);
    expect(act.reaches(REFUNDING_A_DISPUTE)).toBe(false);

    const manage = accessOf(enforced([national("finance", "manage")], []));
    expect(manage.reaches(WAIVING_A_NO_SHOW)).toBe(true);
    expect(manage.reaches(REFUNDING_A_DISPUTE)).toBe(true);
  });

  it("lets a task be taken only with Act in the department that decides its group", () => {
    const care = accessOf(enforced([national("customer_care", "act"), national("finance", "view")], []));
    expect(care.reaches(taskNeed("grievance", "act"))).toBe(true);
    expect(care.reaches(taskNeed("no_show_decision", "act"))).toBe(false);
  });

  it("offers waiving to Finance Manage in one city, which the API then asks in the case's own city", () => {
    const delhi: StaffGrant = { department: "finance", level: "manage", geography: "city", place: "Delhi" };
    expect(accessOf(enforced([delhi], [])).reaches(WAIVING_A_NO_SHOW)).toBe(true);
    expect(accessOf(enforced([{ ...delhi, level: "act" }], [])).reaches(WAIVING_A_NO_SHOW)).toBe(false);
  });

  it("reaches nothing for a person switched off, whatever they hold", () => {
    const off = accessOf({ enforced: true, listed: false, grants: [national("finance", "manage")], may_call: [] });
    expect(off.reaches(WAIVING_A_NO_SHOW)).toBe(false);
  });
});
