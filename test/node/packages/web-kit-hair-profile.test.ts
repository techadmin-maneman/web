// The hair profile form the technician's step and the console's correction share (packages/web-kit/hair-profile.ts),
// held to the API's rules (src/policy/hair-profile.ts; docs/decisions/0106-a-clients-hair-profile.md): a figure the
// form lets through is one the API takes.

import { describe, expect, it } from "vitest";
import {
  bodyOf,
  choicesWith,
  COLOURS,
  figureOf,
  fitFormOf,
  fitOf,
  historyOf,
  MEASUREMENTS,
  refusedFigures,
  toggleRemedy,
  type FitForm,
} from "../../../packages/web-kit/hair-profile.ts";

const HEAD = MEASUREMENTS.head_circumference_cm;

describe("the profile form", () => {
  it("takes a figure in the ranges the API takes, to one decimal", () => {
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

  // The chips ran #1 … #8, #1B, as an object's integer-like keys come first.
  it("offers the colours in the suppliers' order, #1B after #1", () => {
    expect(COLOURS.slice(0, 3)).toEqual(["1", "1B", "2"]);
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

  it("sends the history with the fit spec, none where nothing of it was said, and the version it started from", () => {
    const fit = fitOf(fitFormOf(null));
    if (fit === null) throw new Error("an empty form is a fit spec");
    const history = { remedies: ["minoxidil" as const], transplant_year: null, skin_and_allergies: "Dry" };
    const from = "d0000000-0000-4000-8000-000000000001";
    expect(bodyOf(fit, history, from)).toEqual({ fit, history, based_on: from });
    expect(bodyOf(fit, { remedies: [], transplant_year: null, skin_and_allergies: null }, null)).toEqual({
      fit,
      history: null,
      based_on: null,
    });
  });
});

describe("the console's correction, on the same form", () => {
  // The console checked only that a figure was a number, and left its range to the API.
  it("names each figure typed that the API would refuse", () => {
    const { figures } = fitFormOf(null);
    expect(
      refusedFigures({ ...figures, head_circumference_cm: "90", grey_percent: "50", base_width_in: "abc" }),
    ).toEqual(["head_circumference_cm", "base_width_in"]);
  });

  it("takes a choice from a list's control only as one of the list, and an empty one as none", () => {
    const { choices } = fitFormOf(null);
    expect(choicesWith(choices, "density_percent", "120").density_percent).toBe(120);
    expect(choicesWith(choices, "colour", "1B").colour).toBe("1B");
    expect(choicesWith(choices, "wave", "frizzy").wave).toBeNull();
    expect(choicesWith(choices, "product", "").product).toBeNull();
    expect(choicesWith(choices, "product", "natural").product).toBe("natural");
  });
});
