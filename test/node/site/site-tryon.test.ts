// The try-on's browser-side helpers: what the error screen says.

import { describe, expect, it } from "vitest";
import { errorKindOf, failureKindOf, jobProblem } from "../../../site/src/lib/tryon-errors.ts";

describe("the try-on's error screen", () => {
  it("blames the photograph only when the photograph is the problem", () => {
    expect(errorKindOf("photo_invalid_file")).toBe("photo");
    expect(failureKindOf("photo_unreadable")).toBe("photo");
    expect(failureKindOf("photo_invalid_file")).toBe("photo");
    expect(failureKindOf("render_failed")).toBe("renderFailed");
    expect(failureKindOf("busy")).toBe("busy");
  });

  it("says what YouCam found wrong with the photograph, and that the try-on is paused when it cannot run", () => {
    expect(failureKindOf("photo_unreadable", "no_face")).toBe("noFace");
    expect(failureKindOf("photo_unreadable", "no_shoulders")).toBe("shoulders");
    expect(failureKindOf("photo_unreadable", "face_angle")).toBe("facing");
    expect(failureKindOf("photo_unreadable", "several_people")).toBe("onePerson");
    expect(failureKindOf("photo_unreadable", "not_styleable")).toBe("notStyleable");
    expect(failureKindOf("photo_unreadable", "refused")).toBe("refused");
    expect(failureKindOf("render_failed", "unavailable")).toBe("paused");
    expect(
      jobProblem({ job_id: "j", state: "failed", failure_code: "photo_unreadable", failure_reason: "face_angle" }),
    ).toEqual({ kind: "facing", code: "face_angle" });
  });

  // ADR 0104: the look goes to WhatsApp only, so while WhatsApp cannot send it the try-on is not available.
  it("says the try-on is not available while WhatsApp cannot send its look", () => {
    expect(errorKindOf("whatsapp_unavailable")).toBe("unavailable");
  });

  it("treats limits, Turnstile and the network as busy", () => {
    for (const code of ["rate_limited", "busy", "unavailable", "turnstile_failed", "network"] as const) {
      expect(errorKindOf(code)).toBe("busy");
    }
  });

  it("waits while a job runs, and reads how it ended", () => {
    expect(jobProblem({ job_id: "j", state: "rendering" })).toBeNull();
    expect(jobProblem({ job_id: "j", state: "ready" })).toBeNull();
    expect(jobProblem({ job_id: "j", state: "failed", failure_code: "photo_unreadable" })).toEqual({
      kind: "photo",
      code: "photo_unreadable",
    });
    expect(jobProblem({ job_id: "j", state: "failed" })).toEqual({ kind: "renderFailed", code: "render_failed" });
    expect(jobProblem({ job_id: "j", state: "expired" })).toEqual({ kind: "busy", code: "expired" });
  });
});
