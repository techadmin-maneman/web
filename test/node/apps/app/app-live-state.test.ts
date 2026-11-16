// Where a visit stands on its day, as Home's live card says it (apps/app/src/home/live-state.ts): from the technician's
// word to the step under way, the client's sign-off, and done, being closed or missed; or a move ops asked for.

import { describe, expect, it } from "vitest";
import type { components } from "../../../../apps/app/src/api-schema.ts";
import { liveStateOf } from "../../../../apps/app/src/home/live-state.ts";

type Visit = components["schemas"]["VisitSummary"];
type SignOff = components["schemas"]["SignOff"];

const BOOKED = {
  stage: "booked",
  latest_update: null,
  sign_off: null,
  not_home: false,
  proposed_move: null,
} as unknown as Visit;
const at = (fields: Partial<Visit>): Visit => ({ ...BOOKED, ...fields });
const signOff = (state: SignOff["state"]) => ({ state }) as SignOff;

describe("where a visit stands on its day", () => {
  it("is booked for today until the technician says something", () => {
    expect(liveStateOf(BOOKED)).toBe("today");
  });

  it("follows the technician's latest word", () => {
    for (const kind of ["on_the_way", "running_late", "at_the_gate"] as const) {
      expect(liveStateOf(at({ latest_update: { kind, minutes: 10, at: "2026-11-16T06:00:00.000Z" } }))).toBe(kind);
    }
  });

  it("is at the door, then under way, then the client's sign-off while it is asked or flagged", () => {
    expect(liveStateOf(at({ stage: "arrived" }))).toBe("arrived");
    expect(liveStateOf(at({ stage: "in_progress" }))).toBe("in_progress");
    expect(liveStateOf(at({ stage: "in_progress", sign_off: signOff("asked") }))).toBe("sign_off");
    expect(liveStateOf(at({ stage: "in_progress", sign_off: signOff("flagged") }))).toBe("sign_off");
    expect(liveStateOf(at({ stage: "in_progress", sign_off: signOff("signed") }))).toBe("in_progress");
  });

  it("is a move ops asked for until the client answers it, unless the technician has said something since", () => {
    const proposed = at({ proposed_move: {} as Visit["proposed_move"] });
    expect(liveStateOf(proposed)).toBe("proposal");
    expect(
      liveStateOf({ ...proposed, latest_update: { kind: "on_the_way", minutes: 5, at: "2026-11-16T06:00:00Z" } }),
    ).toBe("on_the_way");
  });

  it("is done once the visit is, however it was signed", () => {
    expect(liveStateOf(at({ stage: "done", sign_off: signOff("asked") }))).toBe("done");
  });

  it("is being closed, never done, when closed otherwise or past its window after arriving", () => {
    expect(liveStateOf(at({ stage: "closing" }))).toBe("closing");
    expect(liveStateOf(at({ stage: "closing", sign_off: signOff("asked") }))).toBe("closing");
  });

  it("is a missed visit where the technician marked the client not home", () => {
    expect(liveStateOf(at({ stage: "closing", not_home: true }))).toBe("not_home");
  });

  it("is missed, never still today, once its window ended with nobody arriving", () => {
    expect(liveStateOf(at({ stage: "missed" }))).toBe("missed");
  });
});
