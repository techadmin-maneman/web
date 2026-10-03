import { describe, expect, it } from "vitest";
import { fieldRecord, recordOfVisit } from "../../src/config/field-record.ts";

describe("recordOfVisit", () => {
  it("is FSM only on FSM's path, for a visit FSM holds", () => {
    expect(recordOfVisit("fsm", { id: "visit-1", fsmId: "fsm-1" })).toBe("fsm");
  });

  it("is our own database for a visit FSM never held, whose FSM ID is its own, on either path", () => {
    expect(recordOfVisit("fsm", { id: "visit-1", fsmId: "visit-1" })).toBe("ours");
    expect(recordOfVisit("ours", { id: "visit-1", fsmId: "visit-1" })).toBe("ours");
  });

  it("is our own database for every visit once FSM is switched off", () => {
    expect(recordOfVisit("ours", { id: "visit-1", fsmId: "fsm-1" })).toBe("ours");
  });
});

describe("fieldRecord", () => {
  it("keeps FSM's path wherever FSM is connected or stubbed", () => {
    expect(fieldRecord({ FSM_PROVIDER: "zoho" })).toBe("fsm");
    expect(fieldRecord({ FSM_PROVIDER: "stub" })).toBe("fsm");
  });

  it("makes our own database the record once FSM is switched off", () => {
    expect(fieldRecord({ FSM_PROVIDER: "none" })).toBe("ours");
  });
});
