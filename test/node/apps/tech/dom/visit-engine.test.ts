// The visit engine (apps/tech/src/visit/engine.ts; docs/decisions/0244-the-visit-engine.md): each visit type's screens
// in the order the brief draws them, each feeding the API's event, and only where the card the API gives says the
// event applies. The cards' steps here are the API's own (src/policy/in-job-steps.ts).

import { describe, expect, it } from "vitest";
import { screensOf } from "../../../../../apps/tech/src/visit/engine.ts";
import { done, nextStep, signedOff, stepsOf } from "../../../../../apps/tech/src/lib/progress.ts";
import type { Queued } from "../../../../../apps/tech/src/store/outbox.ts";
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
      "Client sign-off → sign_off",
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
      "Client sign-off → sign_off",
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
      "Client sign-off → sign_off",
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
        // The hair profile and the sign-off are no events the API orders: each needs only the start.
        if (step !== "profile" && step !== "sign_off") {
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

describe("a fit's sign-off on the phone", () => {
  const fit = { ...jobOf("replacement"), id: "job-1", sign_off: null } as unknown as Job;
  const queued = (kind: string, body: unknown): Queued =>
    ({ job_id: "job-1", kind, body, state: "waiting" }) as unknown as Queued;

  it("lets the fit close once the card says signed or declined, and not while asked or flagged", () => {
    expect(signedOff(fit, [])).toBe(false);
    for (const state of ["signed", "declined"]) {
      expect(signedOff({ ...fit, sign_off: { state } } as unknown as Job, [])).toBe(true);
    }
    for (const state of ["asked", "flagged"]) {
      expect(signedOff({ ...fit, sign_off: { state } } as unknown as Job, [])).toBe(false);
    }
  });

  it("lets it close on what the phone holds to send: a decline, or the client's sign-off on it, not a flag", () => {
    expect(signedOff(fit, [queued("sign_off_declined", { reason: "No phone" })])).toBe(true);
    expect(signedOff(fit, [queued("sign_off", { answer: { result: "signed" } })])).toBe(true);
    expect(signedOff(fit, [queued("sign_off", { answer: { result: "flagged" } })])).toBe(false);
    expect(signedOff(fit, [queued("sign_off_request", {})])).toBe(false);
  });

  it("keeps the technician on the step, and the step not done, while the phone holds only a flag", () => {
    const steps = cardStepsFor("replacement", false);
    const worked = {
      ...fit,
      progress: { steps_done: steps.slice(0, steps.indexOf("sign_off")), checked_in_at: "x", started_at: "x" },
      sent_back: [],
    } as unknown as Job;
    const flag = queued("sign_off", { answer: { result: "flagged", flag_text: "The left edge lifts" } });
    expect(done(worked, [flag]).has("sign_off")).toBe(false);
    expect(nextStep(worked, [flag])).toBe("sign_off");
    const signed = queued("sign_off", { answer: { result: "signed" } });
    expect(done(worked, [signed]).has("sign_off")).toBe(true);
    expect(nextStep(worked, [signed])).toBe("outcome");
  });
});
