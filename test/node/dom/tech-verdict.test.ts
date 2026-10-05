// What each refusal means for the technician outbox's round (apps/tech/src/store/verdict.ts): one table for the writes
// and the photographs a set carries, which once read the same answers differently.

import { describe, expect, it } from "vitest";
import { classify, type Refused } from "../../../apps/tech/src/store/verdict.ts";

const refused = (status: number, code: Refused["code"], over: Partial<Refused> = {}): Refused => ({
  ok: false,
  status,
  code,
  fields: [],
  moved: null,
  requestId: "req",
  ...over,
});

describe("what a refusal means for the round", () => {
  it("waits for signal on none, on a busy API and on a fault of ours", () => {
    for (const answer of [refused(0, "offline"), refused(429, "rate_limited"), refused(503, "unavailable")]) {
      expect(classify(answer)).toEqual({ kind: "retry_later" });
    }
  });

  it("signs out on a 401", () => {
    expect(classify(refused(401, "device_revoked"))).toEqual({ kind: "signed_out" });
  });

  it("holds a check-in or no-show sent too early, which stops nothing", () => {
    expect(classify(refused(425, "too_early_to_arrive"))).toEqual({ kind: "too_early", code: "too_early_to_arrive" });
    expect(classify(refused(425, "too_early_to_close"))).toEqual({ kind: "too_early", code: "too_early_to_close" });
  });

  // An out_of_order on a photograph's upload link was reported as a rejected photograph.
  it("stops the job when it changed under the phone, has closed, went out of order or is gone", () => {
    const moved = { technician: "Vikram", at: "t" };
    expect(classify(refused(409, "superseded", { fields: ["technician"], moved }))).toEqual({
      kind: "superseded",
      note: "superseded",
      fields: ["technician"],
      moved,
    });
    expect(classify(refused(409, "out_of_order"))).toMatchObject({ kind: "superseded", note: "out_of_order" });
    expect(classify(refused(409, "already_closed"))).toMatchObject({ kind: "superseded", note: "already_closed" });
    expect(classify(refused(404, "not_found"))).toMatchObject({ kind: "superseded", note: "not_found" });
  });

  it("stops the job for the technician to put right on anything else, with the API's code and fields", () => {
    const answer = refused(400, "invalid_request", { fields: ["items"] });
    expect(classify(answer)).toEqual({ kind: "refused", note: "invalid_request", fields: ["items"], answer });
  });
});
