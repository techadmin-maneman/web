// The steps of a job (src/policy/in-job-steps.ts), in the order they run.

import { describe, expect, it } from "vitest";
import { ANGLES } from "../../../src/domain/visit-photos.ts";
import { landsAfterClose, PHOTO_ANGLES, stepBefore, stepsFor, takesStep } from "../../../src/policy/in-job-steps.ts";

const done = (...kinds: string[]): ReadonlySet<string> => new Set(kinds);

describe("the steps of a job", () => {
  it("photographs five angles before the work and five after: front, top, left, right, hair", () => {
    expect(PHOTO_ANGLES).toEqual(["front", "top", "left", "right", "hair"]);
    // The photographs the app takes, stores and shows are these five, in this order.
    expect(ANGLES).toBe(PHOTO_ANGLES);
    expect(stepsFor("service").at(0)).toBe("before_photos");
    expect(stepsFor("service").at(-2)).toBe("after_photos");
  });

  it("runs a service visit's checklist and consumables between the photographs, and ends on its outcome", () => {
    expect(stepsFor("service")).toEqual(["before_photos", "checklist", "consumables", "after_photos", "outcome"]);
  });

  it("takes the piece step on a replacement, and never on a service visit or a consultation", () => {
    expect(stepsFor("replacement")).toEqual([
      "before_photos",
      "checklist",
      "consumables",
      "piece",
      "after_photos",
      "outcome",
    ]);
    expect(stepsFor("service")).not.toContain("piece");
    expect(stepsFor("consultation")).not.toContain("piece");
  });

  it("gives a first fit the piece step too: it fits the client's first piece (docs/decisions/0038-offline-writes.md)", () => {
    expect(stepsFor("first_fit")).toContain("piece");
  });

  it("photographs a consultation before and not after, unless it fits a piece", () => {
    expect(stepsFor("consultation")).toEqual(["before_photos", "checklist", "consumables", "outcome"]);
    expect(takesStep("after_photos", "consultation")).toBe(false);
    expect(takesStep("before_photos", "consultation")).toBe(true);
    // A consultation and fit in one visit fits a piece, so it is photographed after as a first fit is.
    expect(takesStep("after_photos", "consultation", true)).toBe(true);
    for (const type of ["first_fit", "service", "replacement"] as const) {
      expect(takesStep("after_photos", type)).toBe(true);
    }
    // Its outcome follows the consumables.
    const toConsumables = done("check_in", "start", "before_photos", "checklist", "consumables");
    expect(stepBefore("outcome", "consultation", toConsumables, { outcome: "done" })).toBeNull();
  });

  it("takes no step before the one ahead of it, so a job sheet cannot close from an empty screen", () => {
    expect(stepBefore("check_in", "service", done(), {})).toBeNull();
    expect(stepBefore("start", "service", done(), {})).toBe("check_in");
    expect(stepBefore("before_photos", "service", done("check_in"), {})).toBe("start");
    expect(stepBefore("checklist", "service", done("check_in", "start"), {})).toBe("before_photos");
    expect(stepBefore("checklist", "service", done("check_in", "start", "before_photos"), {})).toBeNull();
    // A service visit has no piece, so its after photographs follow the consumables.
    const toConsumables = done("check_in", "start", "before_photos", "checklist", "consumables");
    expect(stepBefore("after_photos", "service", toConsumables, {})).toBeNull();
    expect(stepBefore("after_photos", "replacement", toConsumables, {})).toBe("piece");
  });

  // A declined one visit's checklist asked for the fit's items, since the choice came after it.
  it("takes a one visit's choice, at the piece, before its checklist, and then the rest in order", () => {
    expect(stepsFor("first_fit", true)).toEqual([
      "before_photos",
      "piece",
      "checklist",
      "consumables",
      "after_photos",
      "outcome",
    ]);
    const photographed = done("check_in", "start", "before_photos");
    expect(stepBefore("checklist", "first_fit", photographed, {}, true)).toBe("piece");
    expect(stepBefore("piece", "first_fit", photographed, {}, true)).toBeNull();
    // Declined, the visit is a consultation by its close, and its steps stay the one visit's.
    expect(stepBefore("checklist", "consultation", done("check_in", "start", "before_photos", "piece"), {}, true)).toBe(
      null,
    );
  });

  it("closes a no-show from the check-in alone: the job was never started (src/policy/no-show.ts)", () => {
    expect(stepBefore("outcome", "service", done("check_in"), { outcome: "no_show" })).toBeNull();
    expect(stepBefore("outcome", "service", done(), { outcome: "no_show" })).toBe("check_in");
    expect(stepBefore("outcome", "service", done("check_in"), { outcome: "done" })).toBe("start");
  });
});

describe("a closed job", () => {
  const closedAt = new Date("2026-09-21T09:00:00.000Z");
  const minutesLater = (minutes: number) => new Date(closedAt.getTime() + minutes * 60_000);

  it("takes a corrected checklist or count of what was used for an hour after the close, and nothing after", () => {
    expect(landsAfterClose("checklist", closedAt, minutesLater(0))).toBe(true);
    expect(landsAfterClose("consumables", closedAt, minutesLater(59))).toBe(true);
    expect(landsAfterClose("checklist", closedAt, minutesLater(60))).toBe(false);
    expect(landsAfterClose("consumables", closedAt, minutesLater(61))).toBe(false);
  });

  it("takes no other step at all: no second outcome, no check-in, no photographs, no piece", () => {
    for (const kind of ["check_in", "start", "before_photos", "piece", "after_photos", "outcome"] as const) {
      expect(landsAfterClose(kind, closedAt, minutesLater(1)), kind).toBe(false);
    }
  });
});
