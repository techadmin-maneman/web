// The visit engine (apps/tech/src/visit/engine.ts; docs/decisions/0244-the-visit-engine.md): each visit type's screens
// in the order the brief draws them, each feeding the API's event, and only where the card the API gives says the
// event applies. The cards' steps here are the API's own (src/policy/in-job-steps.ts).

import { describe, expect, it } from "vitest";
import { screensOf } from "../../../../../apps/tech/src/visit/engine.ts";
import { stepsOf } from "../../../../../apps/tech/src/lib/progress.ts";
import type { Job } from "../../../../../apps/tech/src/api.ts";
import { cardStepsFor, stepBefore } from "../../../../../src/policy/in-job-steps.ts";
import type { VisitType } from "../../../../../src/config/visit-types.ts";

const jobOf = (type: VisitType, oneVisit = false) =>
  ({ type, one_visit: oneVisit, steps: cardStepsFor(type, oneVisit) }) as unknown as Job;

const order = (job: Job) => screensOf(job).map((screen) => `${screen.title} → ${screen.event}`);

describe("each visit type's screens", () => {
  it("runs a service visit as the brief draws it", () => {
    expect(order(jobOf("service"))).toEqual([
      "Before photos → before_photos",
      "Service → checklist",
      "Consumables → consumables",
      "After photos → after_photos",
      "Outcome → outcome",
    ]);
  });

  it("puts a replacement's hair system before its fitting", () => {
    expect(order(jobOf("replacement"))).toEqual([
      "Before photos → before_photos",
      "Hair system → piece",
      "Fitting → checklist",
      "Consumables → consumables",
      "After photos → after_photos",
      "Outcome → outcome",
    ]);
  });

  it("takes a first fit's hair profile before its hair system", () => {
    expect(order(jobOf("first_fit"))).toEqual([
      "Before photos → before_photos",
      "Hair profile → profile",
      "Hair system → piece",
      "Fitting → checklist",
      "Consumables → consumables",
      "After photos → after_photos",
      "Outcome → outcome",
    ]);
  });

  it("gives a consultation no consumables and no after photos", () => {
    expect(order(jobOf("consultation"))).toEqual([
      "Before photos → before_photos",
      "Scalp and hairline → checklist",
      "Hair profile → profile",
      "Outcome → outcome",
    ]);
  });

  it("runs a consultation and fit in one visit through the fit", () => {
    expect(order(jobOf("consultation", true))).toEqual([
      "Before photos → before_photos",
      "Hair profile → profile",
      "Hair system → piece",
      "Fitting → checklist",
      "Consumables → consumables",
      "After photos → after_photos",
      "Outcome → outcome",
    ]);
  });
});

describe("the steps the phone sends", () => {
  it("sends each of the card's steps once, in the screens' order", () => {
    for (const [type, oneVisit] of [
      ["service", false],
      ["replacement", false],
      ["first_fit", false],
      ["consultation", false],
      ["consultation", true],
    ] as const) {
      const job = jobOf(type, oneVisit);
      const sent = stepsOf(job);
      expect(new Set(sent).size, type).toBe(sent.length);
      expect([...sent].sort(), type).toEqual(
        job.steps.filter((step) => step !== "check_in" && step !== "start").sort(),
      );
    }
  });

  it("sends no step the API would refuse as out of order, for every visit type", () => {
    for (const [type, oneVisit] of [
      ["service", false],
      ["replacement", false],
      ["first_fit", false],
      ["consultation", false],
      ["consultation", true],
    ] as const) {
      const done = new Set<string>(["check_in", "start"]);
      for (const step of stepsOf(jobOf(type, oneVisit))) {
        // The hair profile is no event the API orders (src/routes/tech/jobs.steps.ts): it needs only the start.
        if (step !== "profile") {
          expect(stepBefore({ kind: step, type, done, body: {}, oneVisit }), `${type}: ${step}`).toBeNull();
        }
        done.add(step);
      }
    }
  });

  it("leaves out a screen whose step the card does not carry", () => {
    const job = { ...jobOf("replacement"), steps: jobOf("service").steps } as Job;
    expect(screensOf(job).map((screen) => screen.id)).not.toContain("hair_system");
  });
});
