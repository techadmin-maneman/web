// The piece step checks a label on the phone with the API's own rule, so a
// label the API would refuse is caught where it can still be put right
// (apps/tech/src/steps/label.ts), and the upload queue counts a set by what the
// API confirmed (apps/tech/src/waiting/sets.ts).

import { describe, expect, it } from "vitest";
import { asLabel, isLabel, PIECE_LABEL } from "../../apps/tech/src/steps/label.ts";
import type { Frame, Queued } from "../../apps/tech/src/store/outbox.ts";
import { photoSets, sentOf } from "../../apps/tech/src/waiting/sets.ts";
import { PIECE_CODE_PATTERN } from "../../src/config/pieces.ts";

describe("a piece's label", () => {
  it("is checked with the very pattern the API refuses a label by", () => {
    expect(PIECE_LABEL.source).toBe(PIECE_CODE_PATTERN.source);
  });

  it("reads a space as the hyphen it stands for, and small letters as capitals", () => {
    expect(asLabel("mm-std-7193 c")).toBe("MM-STD-7193-C");
    expect(asLabel(" MM STD  4417 - B")).toBe("MM-STD-4417-B");
    expect(isLabel(asLabel("mm-std-7193 c"))).toBe(true);
  });

  it("keeps a label that is not one from Next", () => {
    expect(isLabel("MM-STD-71")).toBe(false);
    expect(isLabel("MM-STD-7193 C")).toBe(false);
  });
});

const frame = (job: string, phase: "before" | "after", angle: Frame["angle"], at: number): Frame => ({
  id: `${job}:${phase}:${angle}`,
  job_id: job,
  phase,
  angle,
  frame: new Blob(),
  kept_at: at,
});

const setWrite = (job: string, kind: "before_photos" | "after_photos"): Queued => ({
  seq: 1,
  id: "e",
  job_id: job,
  kind,
  path: "",
  body: null,
  queued_at: 0,
  state: "waiting",
  note: null,
  fields: [],
});

describe("a photograph set on its way", () => {
  it("counts nothing sent while its photographs are only held on the phone", () => {
    const held = ["front", "top", "left", "right", "hair"] as const;
    const [set] = photoSets(
      held.map((angle, at) => frame("a", "before", angle, at)),
      [setWrite("a", "before_photos")],
    );
    expect(set).toMatchObject({ job: "a", phase: "before", held: 5, queued: true });
    expect(set === undefined ? -1 : sentOf(set)).toBe(0);
  });

  it("counts each photograph the API confirmed, which the phone let go of", () => {
    const [set] = photoSets([frame("a", "before", "hair", 0)], [setWrite("a", "before_photos")]);
    expect(set === undefined ? -1 : sentOf(set)).toBe(4);
  });

  it("counts a set still being taken as a set, with nothing sent, and each phase as its own", () => {
    const sets = photoSets([frame("a", "after", "front", 1), frame("a", "before", "front", 0)], []);
    expect(sets.map((set) => [set.phase, set.queued])).toEqual([
      ["before", false],
      ["after", false],
    ]);
  });
});
