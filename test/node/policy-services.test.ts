// The services clients book, each rule named by the owner's own words of 27 September 2026
// (src/policy/services.ts; docs/decisions/0085-services-ops-can-edit.md).

import { describe, expect, it } from "vitest";
import { PRICE_TIER } from "../../src/config/ops-settings.ts";
import { STANDARD_TIER, VISIT_TYPES } from "../../src/config/visit-types.ts";
import { isOffered, retireRefusal, RULES, SERVICE_NAME, tierCodeOf } from "../../src/policy/services.ts";

describe("the services", () => {
  it(RULES[0], () => {
    // The kinds are code, four of them, each with its standard tier from the start.
    expect(VISIT_TYPES).toEqual(["consultation", "first_fit", "service", "replacement"]);
    expect(PRICE_TIER.test(STANDARD_TIER)).toBe(true);
    // A service ops add is named by them, and priced under a code made from its first name, which never changes.
    expect(tierCodeOf("Premium")).toBe("premium");
    expect(tierCodeOf("Lace, front")).toBe("lace_front");
    expect(tierCodeOf("Thin-skin (0.03 mm)")).toBe("thin_skin_0_03_mm");
    expect(tierCodeOf("Crème")).toBe("creme");
    expect(tierCodeOf("2 visits")).toBe("visits");
    expect(tierCodeOf("प्रीमियम")).toBeNull();
    expect(tierCodeOf("A very long name for a service that nobody would ever type")).toHaveLength(32);
  });

  it(RULES[1], () => {
    expect(isOffered(null, "2026-10-01")).toBe(true);
    expect(isOffered("2026-10-01", "2026-09-30")).toBe(true);
    // From the day it is retired from, nobody sees it or books it.
    expect(isOffered("2026-10-01", "2026-10-01")).toBe(false);
    expect(isOffered("2026-10-01", "2026-10-02")).toBe(false);
  });

  it("makes every code a price book tier can be", () => {
    for (const name of ["Premium", "Lace, front", "Thin-skin (0.03 mm)", "Crème", "A very long name for a service"]) {
      expect(PRICE_TIER.test(tierCodeOf(name) ?? ""), name).toBe(true);
    }
  });

  it("names a service in any script, but never as a spreadsheet formula would open", () => {
    expect(["Premium", "Lace, front", "प्रीमियम", "2 visits"].map((name) => SERVICE_NAME.test(name))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["=Premium", "+1", "@home", "P", ""].map((name) => SERVICE_NAME.test(name))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("keeps every kind bookable: its last service never retired and priced cannot be retired", () => {
    expect(retireRefusal([])).toBe("last_of_kind");
    expect(retireRefusal([{ retiredDate: "2026-12-01", pricedBy: true }])).toBe("last_of_kind");
    expect(retireRefusal([{ retiredDate: null, pricedBy: false }])).toBe("last_of_kind");
    expect(retireRefusal([{ retiredDate: null, pricedBy: true }])).toBeNull();
  });
});
