// The piece step checks a label on the phone with the API's own rule, so a
// label the API would refuse is caught where it can still be put right
// (apps/tech/src/steps/label.ts), and the upload queue counts a set by what the
// API confirmed (apps/tech/src/waiting/sets.ts).

import { describe, expect, it } from "vitest";
import { asLabel, isLabel, PIECE_LABEL } from "../../../apps/tech/src/steps/label.ts";
import type { Frame, Queued } from "../../../apps/tech/src/store/outbox.ts";
import { anglesRefused, anglesTaken, photoSets, sentOf } from "../../../apps/tech/src/waiting/sets.ts";
import { PIECE_CODE_PATTERN } from "../../../src/config/pieces.ts";

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

  // FLD-15: a set read "0 of 5 sent" while photographs were already on the server.
  it("counts a photograph whose thumbnail is still to go as sent: the photograph has reached us", () => {
    const up: Frame = { ...frame("a", "before", "top", 0), take: "t" };
    const [set] = photoSets([up, frame("a", "before", "left", 1)], [setWrite("a", "before_photos")]);
    expect(set).toMatchObject({ held: 2, up: 1 });
    expect(set === undefined ? -1 : sentOf(set)).toBe(4);
  });
});

// FLD-15, UX-03: a refused set is taken again with only its refused angles, and what reached us counted.
describe("the angles of a set already taken", () => {
  it("are the frames on the phone, in the order taken, while the set is being taken", () => {
    const taken = anglesTaken([frame("a", "before", "left", 2), frame("a", "before", "front", 1)], [], "a", "before");
    expect(taken).toEqual([
      { angle: "front", frameId: "a:before:front" },
      { angle: "left", frameId: "a:before:left" },
    ]);
  });

  it("count each angle no longer on the phone once the set is finished, and leave out a refused frame", () => {
    const refused: Frame = { ...frame("a", "before", "top", 0), refused: true };
    const held = [refused, frame("a", "before", "hair", 1)];
    const finished: Queued = { ...setWrite("a", "before_photos"), state: "refused", note: "photo_rejected" };

    expect(anglesTaken(held, [finished], "a", "before")).toEqual([
      { angle: "front", frameId: null },
      { angle: "left", frameId: null },
      { angle: "right", frameId: null },
      { angle: "hair", frameId: "a:before:hair" },
    ]);
    expect(anglesRefused(held, "a", "before")).toEqual(["top"]);
  });

  it("take nothing from another job's or another phase's frames", () => {
    const others = [frame("b", "before", "front", 0), frame("a", "after", "front", 1)];
    expect(anglesTaken(others, [setWrite("b", "before_photos")], "a", "before")).toEqual([]);
    expect(anglesRefused([{ ...frame("b", "before", "top", 0), refused: true }], "a", "before")).toEqual([]);
  });
});
