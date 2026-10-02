// The try-on's browser-side helpers: the hair-colour detector, on drawn
// images (never photographs of people), and what the error screen says.

import { describe, expect, it } from "vitest";
import { apiColour, detectHairColour, nearestShade } from "../../site/src/lib/hair-colour.ts";
import { errorKindOf, failureKindOf, jobProblem } from "../../site/src/lib/tryon-errors.ts";
import { drawnHead, HEAD_HEIGHT, HEAD_WIDTH } from "./drawn-head.ts";

describe("the hair-colour detector", () => {
  it("names the nearest natural shade", () => {
    expect(nearestShade([22, 20, 18])).toBe("black");
    expect(nearestShade([52, 40, 30])).toBe("brown");
    expect(nearestShade([214, 210, 205])).toBe("white");
  });

  it("sends the API only its six shades, and unknown for the rest", () => {
    expect(apiColour("lightBrown")).toBe("lightBrown");
    expect(apiColour("silver")).toBe("silver");
    expect(apiColour("blonde")).toBe("unknown");
    expect(apiColour("burgundy")).toBe("unknown");
  });

  it("reads brown hair above a face, ignoring the wall", () => {
    expect(detectHairColour(drawnHead([49, 37, 29]), HEAD_WIDTH, HEAD_HEIGHT)).toBe("brown");
  });

  it("reads grey hair", () => {
    expect(detectHairColour(drawnHead([114, 109, 105]), HEAD_WIDTH, HEAD_HEIGHT)).toBe("grey");
  });

  it("calls a dyed shade unknown", () => {
    expect(detectHairColour(drawnHead([113, 22, 17]), HEAD_WIDTH, HEAD_HEIGHT)).toBe("unknown");
  });

  it("does not mistake the wall behind a bare head for hair", () => {
    expect(detectHairColour(drawnHead(null), HEAD_WIDTH, HEAD_HEIGHT)).toBe("unknown");
  });

  it("calls an image with no face unknown", () => {
    const wall = new Uint8ClampedArray(HEAD_WIDTH * HEAD_HEIGHT * 4).fill(180);
    expect(detectHairColour(wall, HEAD_WIDTH, HEAD_HEIGHT)).toBe("unknown");
  });
});

describe("the try-on's error screen", () => {
  it("blames the photograph only when the photograph is the problem", () => {
    expect(errorKindOf("photo_invalid_file")).toBe("photo");
    expect(failureKindOf("photo_unreadable")).toBe("photo");
    expect(failureKindOf("photo_invalid_file")).toBe("photo");
    expect(failureKindOf("render_failed")).toBe("renderFailed");
    expect(failureKindOf("busy")).toBe("busy");
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
