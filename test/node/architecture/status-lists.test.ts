// The sets of statuses a query asks about are written once, in src/config/statuses.ts, and asked with statusIn or
// statusNotIn: a list of them spelled in a query elsewhere is a copy a new status would miss.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every status a visit, a payment or a refund takes. */
const STATUSES = [
  "scheduled",
  "dispatched",
  "in_progress",
  "completed",
  "cancelled",
  "terminated",
  "captured",
  "partially_refunded",
  "refunded",
  "created",
  "processed",
];
const QUOTED = `'(?:${STATUSES.join("|")})'`;
/** `status IN ('a', 'b')`, or `status NOT IN`, on any table's status column. */
const LISTED = new RegExp(`status\\s+(?:NOT\\s+)?IN\\s*\\(\\s*${QUOTED}(?:\\s*,\\s*${QUOTED})+\\s*\\)`, "i");
/** A list kept in a constant: `('a', 'b')` and nothing else in a string. */
const KEPT = new RegExp(`(["'\`])\\(${QUOTED}(?:,\\s*${QUOTED})+\\)\\1`);

function listed(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line, index) => (LISTED.test(line) || KEPT.test(line) ? [`${String(index + 1)}: ${line.trim()}`] : []));
}

const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((file) => file.endsWith(".ts") && file !== "src/config/statuses.ts");

describe("the status sets queries ask about", () => {
  it("know a list of statuses spelled in a query or kept in a constant", () => {
    expect(
      listed("WHERE a.status IN ('scheduled', 'dispatched')\nconst LIVE = \"('scheduled', 'in_progress')\";"),
    ).toEqual([
      "1: WHERE a.status IN ('scheduled', 'dispatched')",
      "2: const LIVE = \"('scheduled', 'in_progress')\";",
    ]);
    expect(listed("WHERE a.status = 'cancelled' AND c.kind IN ('cancelled', 'replaced')")).toEqual([]);
  });

  it("are spelled only in src/config/statuses.ts", () => {
    expect(files.flatMap((file) => listed(readFileSync(file, "utf8")).map((hit) => `${file}:${hit}`))).toEqual([]);
  });
});
