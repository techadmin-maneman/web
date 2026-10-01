// The technician app's hair profile form (apps/tech/src/steps/profile-form.ts), held to the API's rules
// (src/policy/hair-profile.ts; docs/decisions/0106-a-clients-hair-profile.md): a figure the form lets through is one
// the API takes.

import { describe, expect, it } from "vitest";
import {
  bodyOf,
  DENSITIES,
  figureOf,
  FIRST_TRANSPLANT_YEAR,
  fitFormOf,
  fitOf,
  GREY_PERCENT,
  historyOf,
  MEASUREMENTS,
  toggleRemedy,
  type FitForm,
} from "../../apps/tech/src/steps/profile-form.ts";
import * as policy from "../../src/policy/hair-profile.ts";

const HEAD = MEASUREMENTS.head_circumference_cm;

describe("the profile form", () => {
  it("takes a figure in the ranges the API takes, to one decimal", () => {
    expect(MEASUREMENTS).toEqual(policy.MEASUREMENTS);
    expect(GREY_PERCENT).toEqual(policy.GREY_PERCENT);
    expect(DENSITIES).toEqual(policy.DENSITIES);
    expect(FIRST_TRANSPLANT_YEAR).toBe(policy.FIRST_TRANSPLANT_YEAR);

    expect(figureOf("57.5", HEAD)).toBe(57.5);
    expect(figureOf(" 57 ", HEAD)).toBe(57);
    expect(figureOf("", HEAD)).toBeNull();
    for (const typed of ["57.55", "90", "5.7e1", "-57", "fifty"]) expect(figureOf(typed, HEAD)).toBe("invalid");
  });

  it("sends the fit spec only once every figure is one the API takes", () => {
    const form = fitFormOf(null);
    const typed = (figures: Partial<FitForm["figures"]>): FitForm => ({
      ...form,
      figures: { ...form.figures, ...figures },
    });
    expect(fitOf(typed({ base_width_in: "8", grey_percent: "20" }))).toMatchObject({
      base_width_in: 8,
      grey_percent: 20,
    });
    expect(fitOf(typed({ grey_percent: "20.5" }))).toBeNull();
    expect(fitOf(typed({ base_width_in: "80" }))).toBeNull();
  });

  it("takes none of the remedies alone", () => {
    expect(toggleRemedy(["minoxidil"], "none")).toEqual(["none"]);
    expect(toggleRemedy(["none"], "finasteride")).toEqual(["finasteride"]);
    expect(toggleRemedy(["minoxidil", "finasteride"], "minoxidil")).toEqual(["finasteride"]);
  });

  it("keeps a transplant's year only beside a transplant, and never one to come", () => {
    expect(historyOf({ remedies: ["transplant"], year: "2019", skin: " " }, 2026)).toEqual({
      remedies: ["transplant"],
      transplant_year: 2019,
      skin_and_allergies: null,
    });
    expect(historyOf({ remedies: ["minoxidil"], year: "2019", skin: "" }, 2026)?.transplant_year).toBeNull();
    expect(historyOf({ remedies: ["transplant"], year: "2027", skin: "" }, 2026)).toBeNull();
  });

  it("sends the history with the fit spec, and none where nothing of it was said", () => {
    const fit = fitOf(fitFormOf(null));
    if (fit === null) throw new Error("an empty form is a fit spec");
    const history = { remedies: ["minoxidil" as const], transplant_year: null, skin_and_allergies: "Dry" };
    expect(bodyOf(fit, history)).toEqual({ fit, history });
    expect(bodyOf(fit, { remedies: [], transplant_year: null, skin_and_allergies: null })).toEqual({
      fit,
      history: null,
    });
  });
});
