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
  CENTIMETRES,
  centimetresOf,
  inchesOf,
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
      "head_circumference_in",
      "front_to_nape_in",
      "ear_to_ear_in",
      "temple_to_temple_in",
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
    expect(MEASUREMENTS.head_circumference_in.min).toBeGreaterThan(MEASUREMENTS.base_length_in.max);
  });

  it("measures the head in inches, and turns the build before's centimetres into them to one decimal", () => {
    expect(inchesOf(57.5)).toBe(22.6);
    expect(inchesOf(36)).toBe(14.2);
    expect(centimetresOf(22.6)).toBe(57.4);
    // Every centimetre the build before took lands inside the range in inches.
    for (const { inches, min, max } of Object.values(CENTIMETRES)) {
      expect(inchesOf(min)).toBeGreaterThanOrEqual(MEASUREMENTS[inches].min);
      expect(inchesOf(max)).toBeLessThanOrEqual(MEASUREMENTS[inches].max);
    }
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

  it("is recorded at a consultation, a one-visit fit and a first fit", () => {
    expect(takesProfile("consultation", false)).toBe(true);
    expect(takesProfile("first_fit", true)).toBe(true);
    // A one visit the client declined is a consultation, and it was measured all the same.
    expect(takesProfile("consultation", true)).toBe(true);
    // A first fit measures the head again before the piece goes on.
    expect(takesProfile("first_fit", false)).toBe(true);
    expect(takesProfile("service", false)).toBe(false);
    expect(takesProfile("replacement", false)).toBe(false);
    // The card puts it just before the after photographs: on a one visit, once the product is chosen and fitted. A
    // consultation takes no after set, so there it comes just before the outcome.
    expect(cardStepsFor("consultation", false)).toEqual(["before_photos", "checklist", "profile", "outcome"]);
    expect(cardStepsFor("first_fit", true)).toEqual([
      "before_photos",
      "piece",
      "checklist",
      "consumables",
      "profile",
      "after_photos",
      "outcome",
    ]);
    expect(cardStepsFor("first_fit", false)).toEqual(cardStepsFor("first_fit", true));
    expect(cardStepsFor("service", false)).toEqual(stepsFor("service"));
  });

  it("asks no consent of its own for the history", () => {
    // No purpose of its own: the five the client switches are all there are, and no notice asks for a history.
    expect(CONSENT_PURPOSES).toHaveLength(5);
    expect(NOTICES.filter((notice) => /remed|allerg|health/i.test(notice.text.join(" ")))).toEqual([]);
  });
});
