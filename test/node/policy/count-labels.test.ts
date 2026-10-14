// Hair systems counted by their labels (src/domain/inventory/count-labels.ts): what a count's labels found against the
// place, the fields a count's lines get wrong, and the labels as a count line keeps them.

import { describe, expect, it } from "vitest";
import { labelColumns, labelFields, labelsFound, labelsOf } from "../../../src/domain/inventory/count-labels.ts";

const HELD = new Map([["hs-1", new Set(["MM-ESS-0000041-R", "MM-ESS-0000042-S"])]]);

describe("a count by labels", () => {
  it("finds the labels held and not scanned, and those scanned and not held", () => {
    expect(labelsFound(HELD.get("hs-1"), ["MM-ESS-0000042-S", "MM-ESS-0009999-K"])).toEqual({
      missing: ["MM-ESS-0000041-R"],
      unknown: ["MM-ESS-0009999-K"],
    });
    expect(labelsFound(undefined, ["MM-ESS-0009999-K"])).toEqual({ missing: [], unknown: ["MM-ESS-0009999-K"] });
  });

  it("asks for the labels of an item held under them, each once, and a figure that counts them all", () => {
    const lines = [
      { code: "solvent", counted: 3 },
      { code: "hs-1", counted: 2 },
      { code: "hs-1", counted: 2, labels: ["A", "A"] },
      { code: "hs-1", counted: 1, labels: ["A", "B"] },
      { code: "hs-1", counted: 3, labels: ["A", "B"] },
    ];
    expect(labelFields(lines, HELD)).toEqual(["lines.1.labels", "lines.2.labels", "lines.3.counted"]);
  });

  it("keeps a line's labels as JSON, and none for a line counted by number", () => {
    const found = { missing: ["B"], unknown: [] };
    expect(labelColumns({ code: "hs-1", counted: 1, labels: ["A"] }, found)).toEqual({
      labels: '["A"]',
      missing: '["B"]',
      unknown: "[]",
    });
    expect(labelColumns({ code: "solvent", counted: 3 }, null)).toEqual({ labels: null, missing: null, unknown: null });
    expect(labelsOf(null)).toEqual([]);
    expect(labelsOf('["A"]')).toEqual(["A"]);
  });
});
