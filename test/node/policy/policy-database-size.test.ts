// How full the database may get before ops are told (src/policy/database-size.ts).

import { describe, expect, it } from "vitest";
import { DATABASE_LIMIT_BYTES, databaseMarkReached } from "../../../src/policy/database-size.ts";

const GB = 1e9;

describe("the database's size", () => {
  it("is held to Workers Paid's 10 GB a database", () => {
    expect(DATABASE_LIMIT_BYTES).toBe(10 * GB);
  });

  it("is told at half the limit, at 80% of it, and at 95%", () => {
    expect(databaseMarkReached(0)).toBeNull();
    expect(databaseMarkReached(4.99 * GB)).toBeNull();
    expect(databaseMarkReached(5 * GB)).toBe(50);
    expect(databaseMarkReached(7.99 * GB)).toBe(50);
    expect(databaseMarkReached(8 * GB)).toBe(80);
    expect(databaseMarkReached(9.49 * GB)).toBe(80);
    expect(databaseMarkReached(9.5 * GB)).toBe(95);
    expect(databaseMarkReached(12 * GB)).toBe(95);
  });
});
