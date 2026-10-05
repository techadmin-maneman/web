// Who may do what in the ops console (src/policy/access.ts): a department, at a level, over a place, where NCR is a
// zone of five cities.

import { describe, expect, it } from "vitest";
import {
  can,
  grantsChanged,
  isNationalAdmin,
  leavesNoNationalAdmin,
  mayEdit,
  mayRunAccess,
  maySee,
  NATIONAL,
  placesReached,
  reachesCity,
  takesIn,
  type Caller,
  type Grant,
  type Place,
} from "../../../src/policy/access.ts";

const ZONES: ReadonlyMap<string, string> = new Map([
  ["Delhi", "NCR"],
  ["Gurgaon", "NCR"],
  ["Noida", "NCR"],
  ["Ghaziabad", "NCR"],
  ["Faridabad", "NCR"],
  ["Mumbai", "West"],
]);

const NCR: Place = { geography: "zone", name: "NCR" };
const WEST: Place = { geography: "zone", name: "West" };
const DELHI: Place = { geography: "city", name: "Delhi" };
const NOIDA: Place = { geography: "city", name: "Noida" };
const MUMBAI: Place = { geography: "city", name: "Mumbai" };
const PUNE: Place = { geography: "city", name: "Pune" };

const person = (...grants: Grant[]): Caller => ({ kind: "person", active: true, grants });
const grant = (department: Grant["department"], level: Grant["level"], place: Place): Grant => ({
  department,
  level,
  place,
});

describe("a place", () => {
  it("is taken in nationally, by its own zone, or by itself", () => {
    expect(takesIn(NATIONAL, DELHI, ZONES)).toBe(true);
    expect(takesIn(NATIONAL, NCR, ZONES)).toBe(true);
    expect(takesIn(NCR, DELHI, ZONES)).toBe(true);
    expect(takesIn(NCR, NCR, ZONES)).toBe(true);
    expect(takesIn(DELHI, DELHI, ZONES)).toBe(true);
  });

  it("is not taken in by a smaller place, another zone, or another city", () => {
    expect(takesIn(NCR, NATIONAL, ZONES)).toBe(false);
    expect(takesIn(DELHI, NCR, ZONES)).toBe(false);
    expect(takesIn(WEST, DELHI, ZONES)).toBe(false);
    expect(takesIn(DELHI, NOIDA, ZONES)).toBe(false);
    // A city in no zone is reached only nationally or by its own name.
    expect(takesIn(NCR, PUNE, ZONES)).toBe(false);
  });
});

describe("can", () => {
  const zoneLead = person(grant("operations", "act", NCR));

  it("lets a level do what the levels below it can, and nothing above", () => {
    expect(can(zoneLead, "operations", "view", DELHI, ZONES)).toBe(true);
    expect(can(zoneLead, "operations", "act", DELHI, ZONES)).toBe(true);
    expect(can(zoneLead, "operations", "manage", DELHI, ZONES)).toBe(false);
  });

  it("keeps a grant to its own department and its own place", () => {
    expect(can(zoneLead, "finance", "view", DELHI, ZONES)).toBe(false);
    expect(can(zoneLead, "operations", "view", MUMBAI, ZONES)).toBe(false);
    expect(can(zoneLead, "operations", "view", NATIONAL, ZONES)).toBe(false);
  });

  it("asks only for the department and level when the route keeps to the caller's places itself", () => {
    expect(can(person(grant("operations", "view", NOIDA)), "operations", "view", "anywhere", ZONES)).toBe(true);
    expect(can(person(grant("operations", "view", NOIDA)), "operations", "act", "anywhere", ZONES)).toBe(false);
  });

  it("lets nobody in who is not on the list, or is switched off", () => {
    const missing: Caller = { kind: "person", active: false, grants: [] };
    const switchedOff: Caller = { kind: "person", active: false, grants: [grant("admin", "manage", NATIONAL)] };
    expect(can(missing, "operations", "view", "anywhere", ZONES)).toBe(false);
    expect(can(switchedOff, "admin", "view", "anywhere", ZONES)).toBe(false);
  });

  it("lets a listed service token in as every caller was before the list, and an unlisted one nowhere", () => {
    expect(can({ kind: "service", allowed: true }, "finance", "manage", NATIONAL, ZONES)).toBe(true);
    expect(can({ kind: "service", allowed: false }, "operations", "view", "anywhere", ZONES)).toBe(false);
  });
});

describe("editing the Staff list", () => {
  const owner = person(grant("admin", "manage", NATIONAL));
  const ncrAdmin = person(grant("admin", "manage", NCR));
  const delhiViewer = person(grant("admin", "view", DELHI));

  it("lets Admin MANAGE give a grant within their own place", () => {
    const after = { active: true, grants: [grant("finance", "view", NOIDA)] };
    expect(mayEdit(ncrAdmin, null, after, ZONES)).toBe(true);
    expect(mayEdit(owner, null, after, ZONES)).toBe(true);
  });

  it("refuses a grant beyond the editor's place, and an editor without Admin MANAGE", () => {
    expect(mayEdit(ncrAdmin, null, { active: true, grants: [grant("finance", "view", MUMBAI)] }, ZONES)).toBe(false);
    expect(mayEdit(ncrAdmin, null, { active: true, grants: [grant("finance", "view", NATIONAL)] }, ZONES)).toBe(false);
    expect(mayEdit(delhiViewer, null, { active: true, grants: [grant("finance", "view", DELHI)] }, ZONES)).toBe(false);
    expect(mayEdit({ kind: "service", allowed: true }, null, { active: true, grants: [] }, ZONES)).toBe(false);
  });

  it("leaves what lies beyond the editor's place as it is, and asks only of what changes", () => {
    const before = { active: true, grants: [grant("growth", "view", MUMBAI), grant("finance", "view", DELHI)] };
    const after = { active: true, grants: [grant("growth", "view", MUMBAI), grant("finance", "act", DELHI)] };
    expect(mayEdit(ncrAdmin, before, after, ZONES)).toBe(true);
    const dropsMumbai = { active: true, grants: [grant("finance", "act", DELHI)] };
    expect(mayEdit(ncrAdmin, before, dropsMumbai, ZONES)).toBe(false);
  });

  it("switches a person off only with Admin MANAGE over every place they hold", () => {
    const before = { active: true, grants: [grant("growth", "view", MUMBAI), grant("finance", "view", DELHI)] };
    expect(mayEdit(ncrAdmin, before, { ...before, active: false }, ZONES)).toBe(false);
    expect(mayEdit(owner, before, { ...before, active: false }, ZONES)).toBe(true);
  });

  it("names what an edit gives and takes away", () => {
    const viewDelhi = grant("finance", "view", DELHI);
    const actDelhi = grant("finance", "act", DELHI);
    expect(grantsChanged([viewDelhi], [actDelhi])).toEqual([viewDelhi, actDelhi]);
    expect(grantsChanged([viewDelhi], [viewDelhi])).toEqual([]);
  });

  it("shows a viewer the people in their places, and those with no grant yet", () => {
    expect(maySee(delhiViewer, { active: true, grants: [grant("finance", "act", DELHI)] }, ZONES)).toBe(true);
    expect(maySee(delhiViewer, { active: true, grants: [grant("finance", "act", MUMBAI)] }, ZONES)).toBe(false);
    expect(maySee(delhiViewer, { active: true, grants: [grant("admin", "manage", NATIONAL)] }, ZONES)).toBe(false);
    expect(maySee(delhiViewer, { active: true, grants: [] }, ZONES)).toBe(true);
  });
});

describe("Admin MANAGE nationally", () => {
  const owner = { email: "owner@maneman.in", active: true, grants: [grant("admin", "manage", NATIONAL)] };
  const lead = { email: "lead@maneman.in", active: true, grants: [grant("operations", "act", NCR)] };

  it("is held only actively and nationally", () => {
    expect(isNationalAdmin(owner)).toBe(true);
    expect(isNationalAdmin({ ...owner, active: false })).toBe(false);
    expect(isNationalAdmin({ active: true, grants: [grant("admin", "manage", NCR)] })).toBe(false);
  });

  it("alone runs the switch and the service tokens, and only as a person", () => {
    expect(mayRunAccess(person(grant("admin", "manage", NATIONAL)))).toBe(true);
    expect(mayRunAccess(person(grant("admin", "manage", NCR)))).toBe(false);
    expect(mayRunAccess({ kind: "person", active: false, grants: [grant("admin", "manage", NATIONAL)] })).toBe(false);
    expect(mayRunAccess({ kind: "service", allowed: true })).toBe(false);
  });

  it("is always held by somebody once anybody holds it", () => {
    expect(leavesNoNationalAdmin([owner, lead], owner.email, { ...owner, active: false })).toBe(true);
    expect(leavesNoNationalAdmin([owner, lead], owner.email, { active: true, grants: [] })).toBe(true);
    expect(leavesNoNationalAdmin([owner, lead], lead.email, { ...lead, active: false })).toBe(false);
    const second = { ...owner, email: "second@maneman.in" };
    expect(leavesNoNationalAdmin([owner, second], owner.email, { ...owner, active: false })).toBe(false);
  });

  it("may be given from nothing, on a list that has nobody with it yet", () => {
    expect(leavesNoNationalAdmin([lead], lead.email, { ...lead, active: false })).toBe(false);
  });
});

describe("the places a caller reaches", () => {
  const enforced = (caller: Caller) => ({ enforced: true, caller, zoneOf: ZONES });
  const citiesOf = (caller: Caller, level: Grant["level"] = "view") => {
    const reached = placesReached(enforced(caller), "customer_care", level);
    return reached.kind === "everywhere" ? "everywhere" : [...reached.cities].sort();
  };

  it("are everywhere for a national grant, and for anyone while the list is not enforced", () => {
    expect(citiesOf(person(grant("customer_care", "act", NATIONAL)))).toBe("everywhere");
    const nobody = { enforced: false, caller: person(), zoneOf: ZONES };
    expect(placesReached(nobody, "customer_care", "manage")).toEqual({ kind: "everywhere" });
  });

  it("are a zone's cities and each city granted, in the department at the level or above", () => {
    const lead = person(
      grant("customer_care", "view", NCR),
      grant("customer_care", "manage", PUNE),
      grant("finance", "manage", MUMBAI),
    );
    expect(citiesOf(lead)).toEqual(["Delhi", "Faridabad", "Ghaziabad", "Gurgaon", "Noida", "Pune"]);
    expect(citiesOf(lead, "act")).toEqual(["Pune"]);
  });

  it("are none for a person switched off, or a service token not on the list", () => {
    const off: Caller = { kind: "person", active: false, grants: [grant("customer_care", "view", DELHI)] };
    expect(citiesOf(off)).toEqual([]);
    expect(citiesOf({ kind: "service", allowed: false })).toEqual([]);
    expect(citiesOf({ kind: "service", allowed: true })).toBe("everywhere");
  });

  it("take in a record in one of their cities, and one in no city only everywhere", () => {
    const delhi = placesReached(enforced(person(grant("customer_care", "view", DELHI))), "customer_care", "view");
    expect(reachesCity(delhi, "Delhi")).toBe(true);
    expect(reachesCity(delhi, "Noida")).toBe(false);
    expect(reachesCity(delhi, null)).toBe(false);
    expect(reachesCity({ kind: "everywhere" }, null)).toBe(true);
  });
});
