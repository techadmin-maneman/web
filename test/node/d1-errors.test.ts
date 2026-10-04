// What a D1 error says (src/lib/d1-errors.ts): which table's unique key a write broke, and whether a failure passes by
// itself.

import { describe, expect, it } from "vitest";
import { failedNotNullOn, failedUniqueOn, isTransientD1Error } from "../../src/lib/d1-errors.ts";

const sqlite = (message: string) => new Error(`D1_ERROR: ${message}: SQLITE_CONSTRAINT`);

describe("a D1 error", () => {
  it("names the table whose unique key a write broke, and no other", () => {
    const clash = sqlite("UNIQUE constraint failed: slot_claims.technician_id, slot_claims.date, slot_claims.claim");
    expect(failedUniqueOn(clash, "slot_claims")).toBe(true);
    expect(failedUniqueOn(sqlite("UNIQUE constraint failed: people.mobile_e164"), "slot_claims")).toBe(false);
    expect(failedUniqueOn("UNIQUE constraint failed: slot_claims.date", "slot_claims")).toBe(false);
  });

  it("names the column a write left empty", () => {
    const error = sqlite("NOT NULL constraint failed: dispatch_moves.appointment_id");
    expect(failedNotNullOn(error, "dispatch_moves.appointment_id")).toBe(true);
    expect(failedNotNullOn(error, "dispatch_moves.reason")).toBe(false);
  });

  it("passes by itself when the connection was lost, the storage reset, or an export held the database", () => {
    for (const message of [
      "D1_ERROR: Network connection lost.",
      '{"D1_RESET_DO":true}',
      "D1_ERROR: Currently processing a long-running export.",
    ]) {
      expect(isTransientD1Error(new Error(message)), message).toBe(true);
    }
    expect(isTransientD1Error(sqlite("UNIQUE constraint failed: people.mobile_e164"))).toBe(false);
    expect(isTransientD1Error(new Error("D1_ERROR: no such table: nowhere"))).toBe(false);
  });
});
