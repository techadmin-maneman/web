// How full the database may get before ops are told (src/policy/database-size.ts).

import { describe, expect, it } from "vitest";
import { DATABASE_LIMIT_BYTES, databaseMarkReached } from "../../../src/policy/database-size.ts";

const MB = 1e6;

describe("the database's size", () => {
  it("is held to Workers Free's 500 MB a database", () => {
    expect(DATABASE_LIMIT_BYTES).toBe(500 * MB);
  });

  it("is told at half the limit, at 80% of it, and at 95%", () => {
    expect(databaseMarkReached(0)).toBeNull();
    expect(databaseMarkReached(249 * MB)).toBeNull();
    expect(databaseMarkReached(250 * MB)).toBe(50);
    expect(databaseMarkReached(399 * MB)).toBe(50);
    expect(databaseMarkReached(400 * MB)).toBe(80);
    expect(databaseMarkReached(474 * MB)).toBe(80);
    expect(databaseMarkReached(475 * MB)).toBe(95);
    expect(databaseMarkReached(600 * MB)).toBe(95);
  });
});
