// The code the console shows for a new service (apps/ops/src/settings/code.ts)
// against the code the API makes from the same name (tierCodeOf,
// src/policy/services.ts). The console cannot import the API's policy, so it
// keeps its own copy; if the two drift, the form would show one code and the
// book would keep another (docs/decisions/0085-services-ops-can-edit.md).

import { describe, expect, it } from "vitest";
import { CODE, codeOf } from "../../apps/ops/src/settings/code.ts";
import { PRICE_TIER } from "../../src/config/ops-settings.ts";
import { tierCodeOf } from "../../src/policy/services.ts";

const NAMES = [
  "Premium",
  "Lace, front",
  "Lace replacement",
  "Café crème",
  "Über-fit (2 hours)",
  "  spaced  out  ",
  "2nd fit",
  "Fit & finish / touch-up",
  "Hair's own weight",
  "A name long enough that its code has to stop somewhere short of it",
  "हेयर पैच",
  "123",
];

describe("the code a new service is priced under", () => {
  it.each(NAMES)("is the same in the console as in the API for %j", (name) => {
    expect(codeOf(name)).toBe(tierCodeOf(name) ?? "");
  });

  it("is only ever one the price book takes, or nothing", () => {
    for (const name of NAMES) {
      const code = codeOf(name);
      if (code !== "") expect(code).toMatch(PRICE_TIER);
    }
  });

  it("is checked in the console by the book's own rule", () => {
    expect(CODE.source).toBe(PRICE_TIER.source);
  });

  it("reads a name the way ops will expect", () => {
    expect(codeOf("Premium")).toBe("premium");
    expect(codeOf("Lace, front")).toBe("lace_front");
    expect(codeOf("Café crème")).toBe("cafe_creme");
  });
});
