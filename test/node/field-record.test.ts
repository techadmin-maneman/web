import { describe, expect, it } from "vitest";
import { fieldRecord } from "../../src/config/field-record.ts";

describe("fieldRecord", () => {
  it("keeps FSM's path wherever FSM is connected or stubbed", () => {
    expect(fieldRecord({ FSM_PROVIDER: "zoho" })).toBe("fsm");
    expect(fieldRecord({ FSM_PROVIDER: "stub" })).toBe("fsm");
  });

  it("makes our own database the record once FSM is switched off", () => {
    expect(fieldRecord({ FSM_PROVIDER: "none" })).toBe("ours");
  });
});
