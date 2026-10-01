// A client's hair profile (src/policy/hair-profile.ts), each rule named by the owner's ruling of 1 October 2026, or
// by what the build took for the owner to confirm (ADR 0106).

import { describe, expect, it } from "vitest";
import { CONSENT_PURPOSES, HEALTH_HISTORY } from "../../src/policy/consents.ts";
import {
  ATTACHMENTS,
  COLOURS,
  DEFAULTS,
  DENSITIES,
  HAIRLINES,
  historyProblems,
  MEASUREMENTS,
  NORWOOD_STAGES,
  REMEDIES,
  RULES,
  SKIN_AND_ALLERGIES_MAX,
  takesProfile,
  WAVES,
} from "../../src/policy/hair-profile.ts";
import { cardStepsFor, stepsFor } from "../../src/policy/in-job-steps.ts";

const NOW = new Date("2026-10-01T06:30:00Z");

const history = (remedies: string[], transplantYear: number | null = null) => ({
  remedies,
  transplant_year: transplantYear,
  skin_and_allergies: null,
});

describe("a client's hair profile", () => {
  it(RULES[0], () => {
    expect(NORWOOD_STAGES).toEqual(["I", "II", "III", "IV", "V", "VI", "VII"]);
    expect(Object.keys(MEASUREMENTS)).toEqual([
      "head_circumference_cm",
      "front_to_nape_cm",
      "ear_to_ear_cm",
      "temple_to_temple_cm",
      "base_width_in",
      "base_length_in",
    ]);
    expect(COLOURS.slice(0, 3)).toEqual(["1", "1B", "2"]);
    expect(DENSITIES).toEqual([80, 100, 120, 140]);
    expect(WAVES).toEqual(["straight", "slight_wave", "wavy", "curly"]);
    expect(HAIRLINES.length).toBeGreaterThan(0);
    expect(ATTACHMENTS).toEqual(["tape", "glue", "both"]);
    // A range a head or a base can have, never one a typo can reach.
    for (const range of Object.values(MEASUREMENTS)) expect(range.min).toBeLessThan(range.max);
    expect(MEASUREMENTS.head_circumference_cm.min).toBeGreaterThan(MEASUREMENTS.base_length_in.max);
  });

  it(RULES[1], () => {
    expect(REMEDIES).toEqual(["none", "minoxidil", "finasteride", "transplant", "other_systems", "other"]);
    expect(historyProblems(history(["minoxidil", "finasteride", "transplant"], 2019), NOW)).toEqual([]);
    expect(historyProblems(history([]), NOW)).toEqual([]);
    // "None" is said alone, and a remedy is named once.
    expect(historyProblems(history(["none", "minoxidil"]), NOW)).toEqual(["remedies"]);
    expect(historyProblems(history(["minoxidil", "minoxidil"]), NOW)).toEqual(["remedies"]);
    // A transplant has its year, which is no later than this one, and only a transplant has one.
    expect(historyProblems(history(["transplant"], 2027), NOW)).toEqual(["transplant_year"]);
    expect(historyProblems(history(["minoxidil"], 2019), NOW)).toEqual(["transplant_year"]);
    expect(historyProblems(history(["transplant"]), NOW)).toEqual([]);
    expect(SKIN_AND_ALLERGIES_MAX).toBeLessThanOrEqual(200);
  });

  it(DEFAULTS[0], () => {
    expect(takesProfile("consultation", false)).toBe(true);
    expect(takesProfile("first_fit", true)).toBe(true);
    // A one visit the client declined is a consultation, and it was measured all the same.
    expect(takesProfile("consultation", true)).toBe(true);
    expect(takesProfile("first_fit", false)).toBe(false);
    expect(takesProfile("service", false)).toBe(false);
    expect(takesProfile("replacement", false)).toBe(false);
    // The card puts it just before the after photographs: on a one visit, once the product is chosen and fitted.
    expect(cardStepsFor("consultation", false)).toEqual([
      "before_photos",
      "checklist",
      "consumables",
      "profile",
      "after_photos",
      "outcome",
    ]);
    expect(cardStepsFor("first_fit", true)).toEqual([
      "before_photos",
      "checklist",
      "consumables",
      "piece",
      "profile",
      "after_photos",
      "outcome",
    ]);
    expect(cardStepsFor("service", false)).toEqual(stepsFor("service"));
  });

  it(DEFAULTS[2], () => {
    // A purpose of its own, never one of the five the client switches in the app.
    expect(HEALTH_HISTORY).toBe("health_history");
    expect(CONSENT_PURPOSES).not.toContain(HEALTH_HISTORY);
  });
});
