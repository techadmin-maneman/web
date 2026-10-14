// Routes call the domain, which owns the SQL (docs/architecture.md, "Routes"): a route file holds no more statements
// of its own than ./route-sql-baseline.ts counts today, and a new one holds none. Lower a figure, or delete its line,
// as a file's SQL moves into the domain.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTE_SQL } from "./route-sql-baseline.ts";

const counted = Object.fromEntries(
  execFileSync("git", ["ls-files", "src/routes"], { encoding: "utf8" })
    .split("\n")
    .filter((file) => file.endsWith(".ts"))
    .map((file) => [file, readFileSync(file, "utf8").match(/\.prepare\(/g)?.length ?? 0] as const)
    .filter(([, count]) => count > 0),
);

describe("the routes' SQL", () => {
  it("grows in no route file", () => {
    const over = Object.entries(counted).filter(([file, count]) => count > (ROUTE_SQL[file] ?? 0));
    expect(over.map(([file, count]) => `${file}: ${String(count)}`)).toEqual([]);
  });

  it("is counted as it is, so a file that sheds some lowers its figure", () => {
    const under = Object.entries(ROUTE_SQL).filter(([file, count]) => (counted[file] ?? 0) < count);
    expect(under.map(([file]) => file)).toEqual([]);
  });
});
