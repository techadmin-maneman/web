// The technician app's hair profile form (apps/tech/src/steps/profile-form.ts), held to the API's rules
// (src/policy/hair-profile.ts) and to the consent the API records (src/config/notices.ts;
// docs/decisions/0106-a-clients-hair-profile.md): a figure the form lets through is one the API takes, and the words
// the client is shown are the notice their answer is recorded under.

import { describe, expect, it } from "vitest";
import { profile } from "../../apps/tech/src/content.ts";
import {
  agreedTo,
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
import { CURRENT_NOTICE, findNotice } from "../../src/config/notices.ts";
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
});

describe("the consent the history needs", () => {
  const { version, lines } = profile.health.notice;

  it("is shown word for word as the notice the API records it under, which is the one it shows today", () => {
    expect(version).toBe(CURRENT_NOTICE.health_history);
    expect(lines).toEqual(findNotice(version)?.text);
  });

  it("is asked again unless it was given on these words", () => {
    expect(agreedTo({ state: "given", notice_version: version, at: "t" }, version)).toBe(true);
    expect(agreedTo({ state: "given", notice_version: "health-history-v0", at: "t" }, version)).toBe(false);
    expect(agreedTo({ state: "withdrawn", notice_version: version, at: "t" }, version)).toBe(false);
    expect(agreedTo(null, version)).toBe(false);
  });

  it("sends the history only where the client agreed, and the words they answered on", () => {
    const fit = fitOf(fitFormOf(null));
    if (fit === null) throw new Error("an empty form is a fit spec");
    const history = { remedies: ["minoxidil" as const], transplant_year: null, skin_and_allergies: "Dry" };
    expect(bodyOf(fit, { answer: "agrees", history, version }).health).toEqual({
      consent: "given",
      notice_version: version,
      ...history,
    });
    expect(bodyOf(fit, { answer: "declines", history, version }).health).toEqual({
      consent: "refused",
      notice_version: version,
    });
    expect(bodyOf(fit, { answer: "not_asked", history, version }).health).toBeNull();
  });
});
