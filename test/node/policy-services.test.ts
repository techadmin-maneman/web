// The services clients book, each rule named by the owner's own words of 27 September 2026
// (src/policy/services.ts; docs/decisions/0085-services-ops-can-edit.md).

import { describe, expect, it } from "vitest";
import { hasStandardService, STANDARD_TIER, VISIT_TYPES } from "../../src/config/visit-types.ts";
import {
  DESCRIPTION_LENGTH,
  isOffered,
  isServiceDescription,
  namesMoreThanItsKind,
  retireRefusal,
  RULES,
  SERVICE_NAME,
  tierCodeOf,
  PRICE_TIER,
} from "../../src/policy/services.ts";

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

  // A client choosing a hair system reads what sets each apart, in one line ops write.
  it("describes a service in one line of up to 160 characters, or not at all", () => {
    expect(isServiceDescription("Made for men who sweat.")).toBe(true);
    expect(isServiceDescription("A".repeat(DESCRIPTION_LENGTH))).toBe(true);
    expect(isServiceDescription("")).toBe(true);
    expect(isServiceDescription("A".repeat(DESCRIPTION_LENGTH + 1))).toBe(false);
    expect(isServiceDescription("Made for men\nwho sweat.")).toBe(false);
    expect(isServiceDescription("Made for men\twho sweat.")).toBe(false);
  });

  it("keeps a kind with a standard service bookable: its last service never retired and priced cannot be retired", () => {
    for (const kind of ["consultation", "service", "replacement"] as const) {
      expect(retireRefusal(kind, [])).toBe("last_of_kind");
      expect(retireRefusal(kind, [{ retiredDate: "2026-12-01", pricedBy: true }])).toBe("last_of_kind");
      expect(retireRefusal(kind, [{ retiredDate: null, pricedBy: false }])).toBe("last_of_kind");
      expect(retireRefusal(kind, [{ retiredDate: null, pricedBy: true }])).toBeNull();
    }
  });

  // The owner's decision of 2 October 2026: only the hair systems ops offer, and no generic first fit in their place.
  it("lets ops retire a first fit's every hair system, so nothing stands in for them", () => {
    expect(hasStandardService("first_fit")).toBe(false);
    expect(retireRefusal("first_fit", [])).toBeNull();
    expect(retireRefusal("first_fit", [{ retiredDate: "2026-12-01", pricedBy: true }])).toBeNull();
  });

  // The product a client paid for reaches the technician, ops and the client by its service's name.
  it("names a visit's service where it says more than the kind", () => {
    expect(namesMoreThanItsKind("essential", null)).toBe(true);
    expect(namesMoreThanItsKind("essential", "fitted")).toBe(true);
    // A kind's standard service is named as the kind is; a visit the mirror knows no service of was the standard one.
    expect(namesMoreThanItsKind(STANDARD_TIER, null)).toBe(false);
    expect(namesMoreThanItsKind(null, null)).toBe(false);
    // A one visit is held as the first hair system on offer until the client chooses.
    expect(namesMoreThanItsKind("essential", "booked")).toBe(false);
  });
});
