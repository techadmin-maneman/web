// Test data goes through test/worker/fixtures/: each builder gives a table's row its defaults in one place, so a
// column the schema adds, or drops, is met once. The worker tests that write those tables as INSERT statements of
// their own today are counted in ./test-data-baseline.ts; a file may only write fewer, and a new one none.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RAW_INSERTS } from "./test-data-baseline.ts";

/** The tables a builder writes. */
const BUILT = ["people", "addresses", "appointments", "technicians", "slot_holds", "payments"];
const RAW = new RegExp(`INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+(?:${BUILT.join("|")})\\b`, "gi");

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return path === "test/worker/fixtures" ? [] : filesUnder(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

const counted = Object.fromEntries(
  filesUnder("test/worker")
    .map((file) => [file, readFileSync(file, "utf8").match(RAW)?.length ?? 0] as const)
    .filter(([, count]) => count > 0),
);

describe("the worker tests' data", () => {
  it("is written through the fixtures, or no more often by hand than the baseline counts", () => {
    const over = Object.entries(counted).filter(([file, count]) => count > (RAW_INSERTS[file] ?? 0));
    expect(over.map(([file, count]) => `${file}: ${String(count)}`)).toEqual([]);
  });

  it("is counted as it stands, so the baseline only falls", () => {
    const under = Object.entries(RAW_INSERTS).filter(([file, count]) => (counted[file] ?? 0) < count);
    expect(under.map(([file, count]) => `${file}: ${String(counted[file] ?? 0)}, not ${String(count)}`)).toEqual([]);
  });
});
