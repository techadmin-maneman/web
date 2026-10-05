// A client's hair profile (src/policy/hair-profile.ts; ADR 0106).

import { describe, expect, it } from "vitest";
import { NOTICES } from "../../../src/config/notices.ts";
import { CONSENT_PURPOSES } from "../../../src/policy/consents.ts";
import {
  ATTACHMENTS,
  COLOURS,
  DENSITIES,
  HAIRLINES,
  historyProblems,
  MEASUREMENTS,
  NORWOOD_STAGES,
  REMEDIES,
  SKIN_AND_ALLERGIES_MAX,
  takesProfile,
  WAVES,
} from "../../../src/policy/hair-profile.ts";
import { cardStepsFor, stepsFor } from "../../../src/policy/in-job-steps.ts";

const NOW = new Date("2026-10-01T06:30:00Z");

const history = (remedies: string[], transplantYear: number | null = null) => ({
  remedies,
  transplant_year: transplantYear,
  skin_and_allergies: null,
});

describe("a client's hair profile", () => {
  it("records the fit spec: Norwood stage, measurements, base, colour, density, wave, hairline and attachment", () => {
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

  it("takes the remedies tried, none said alone and each named once, with short notes on skin and allergies", () => {
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

  it("is recorded at a consultation and at a one-visit fit", () => {
    expect(takesProfile("consultation", false)).toBe(true);
    expect(takesProfile("first_fit", true)).toBe(true);
    // A one visit the client declined is a consultation, and it was measured all the same.
    expect(takesProfile("consultation", true)).toBe(true);
    expect(takesProfile("first_fit", false)).toBe(false);
    expect(takesProfile("service", false)).toBe(false);
    expect(takesProfile("replacement", false)).toBe(false);
    // The card puts it just before the after photographs: on a one visit, once the product is chosen and fitted. A
    // consultation takes no after set, so there it comes just before the outcome.
    expect(cardStepsFor("consultation", false)).toEqual([
      "before_photos",
      "checklist",
      "consumables",
      "profile",
      "outcome",
    ]);
    expect(cardStepsFor("first_fit", true)).toEqual([
      "before_photos",
      "piece",
      "checklist",
      "consumables",
      "profile",
      "after_photos",
      "outcome",
    ]);
    expect(cardStepsFor("service", false)).toEqual(stepsFor("service"));
    // A job with no client of ours has nobody to keep a profile for.
    expect(cardStepsFor("consultation", false, false)).toEqual(stepsFor("consultation"));
  });

  it("asks no consent of its own for the history", () => {
    // No purpose of its own: the five the client switches are all there are, and no notice asks for a history.
    expect(CONSENT_PURPOSES).toHaveLength(5);
    expect(NOTICES.filter((notice) => /remed|allerg|health/i.test(notice.text.join(" ")))).toEqual([]);
  });
});
