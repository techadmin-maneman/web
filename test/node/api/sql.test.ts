// A row written from one object (src/lib/sql.ts).

import { describe, expect, it } from "vitest";
import { insertRow } from "../../../src/lib/sql.ts";

/** A database that hands back what it was asked to prepare and bind. */
const recording = {
  prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values }) }),
} as unknown as D1Database;

describe("insertRow", () => {
  it("binds each value to its own column's placeholder, in the row's order", () => {
    const statement = insertRow(recording, "consumables", { code: "tape", name: "Tape", unit_cost: 450, note: null });
    expect(statement).toEqual({
      sql: "INSERT INTO consumables (code, name, unit_cost, note) VALUES (?1, ?2, ?3, ?4)",
      values: ["tape", "Tape", 450, null],
    });
  });

  it("puts what follows the values after them, as a conflict clause", () => {
    const statement = insertRow(recording, "referral_attributions", { id: "r1" }, "ON CONFLICT (id) DO NOTHING");
    expect(statement).toMatchObject({
      sql: "INSERT INTO referral_attributions (id) VALUES (?1) ON CONFLICT (id) DO NOTHING",
    });
  });
});
