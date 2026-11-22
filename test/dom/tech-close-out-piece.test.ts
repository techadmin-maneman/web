// The hair system a close-out names (apps/tech/src/steps/CloseOut.tsx): the piece step still on the phone by its label,
// or by its hair system where it went with none; else the client's newest piece fitted on the visit's day.

import { describe, expect, it } from "vitest";
import type { Job } from "../../apps/tech/src/api.ts";
import { fittedPiece } from "../../apps/tech/src/steps/CloseOut.tsx";
import type { Queued } from "../../apps/tech/src/store/outbox.ts";

const JOB = {
  id: "job-1",
  date: "2026-09-21",
  steps: ["piece"],
  pieces: [],
  kit_hair_systems: [{ code: "hs_standard", name: "Mane Man Standard · 8 × 10 in" }],
} as unknown as Job;

const waiting = (body: object) => [{ job_id: "job-1", kind: "piece", body }] as unknown as Queued[];

describe("the close-out's hair system", () => {
  it("is the label the waiting piece step names", () => {
    expect(fittedPiece(JOB, waiting({ piece_code: "MM-STD-0000123-K", stock_code: "hs_standard" }))).toBe(
      "MM-STD-0000123-K",
    );
  });

  it("is the hair system picked where the waiting step went with no label", () => {
    expect(fittedPiece(JOB, waiting({ no_label: true, stock_code: "hs_standard" }))).toBe(
      "Mane Man Standard · 8 × 10 in",
    );
  });

  it("is none where nothing waits and no piece was fitted on the visit's day", () => {
    expect(fittedPiece(JOB, [])).toBeNull();
  });
});
