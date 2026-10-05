// A code made from words ops type (src/lib/slug.ts), the same for a consumable, a job-sheet item and a service tier.

import { describe, expect, it } from "vitest";
import { freshCode, slugOf } from "../../src/lib/slug.ts";
import { tierCodeOf } from "../../src/policy/services.ts";

describe("a code from words", () => {
  it("drops accents, so the same words give the same code wherever they are typed", () => {
    expect(slugOf("Crème adhesive", 32)).toBe("creme_adhesive");
    expect(freshCode("Crème adhesive", 32, "consumable", new Set())).toBe("creme_adhesive");
    expect(tierCodeOf("Crème adhesive")).toBe("creme_adhesive");
  });

  it("joins words with _, keeps to its length, and ends on no _", () => {
    expect(slugOf("Tape strips, 3M", 32)).toBe("tape_strips_3m");
    expect(slugOf("A very long name for a consumable indeed", 12)).toBe("a_very_long");
  });

  it("numbers a new code past those taken, and falls back where the words give none", () => {
    expect(freshCode("Tape strips", 32, "consumable", new Set(["tape_strips"]))).toBe("tape_strips_2");
    expect(freshCode("Tape strips", 32, "consumable", new Set(["tape_strips", "tape_strips_2"]))).toBe("tape_strips_3");
    expect(freshCode("टेप", 32, "consumable", new Set())).toBe("consumable");
  });

  it("starts a service tier's code with a letter, as its prices' key must", () => {
    expect(tierCodeOf("3M tape")).toBe("m_tape");
    expect(tierCodeOf("Premium")).toBe("premium");
    expect(tierCodeOf("टेप")).toBeNull();
  });
});
