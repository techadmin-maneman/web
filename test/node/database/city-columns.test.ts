// A city's name is its key, so a rename moves every row that names it (src/domain/cities/city-changes.ts,
// docs/decisions/0198-cities-as-data.md). A table that gains a column naming a city fails here until the rename moves it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CITY_COLUMNS } from "../../../src/domain/cities/city-changes.ts";

/** Every column of src/lib/rows.ts whose name says it holds a city, as "table.column". */
function cityColumns(): string[] {
  const columns: string[] = [];
  let table: string | null = null;
  for (const line of readFileSync("src/lib/rows.ts", "utf8").split("\n")) {
    const opened = /^ {2}readonly (\w+): \{$/.exec(line);
    if (opened !== null) table = opened[1] ?? null;
    const column = /^ {4}readonly (\w*city\w*):/.exec(line);
    if (column !== null && table !== null && table !== "cities") columns.push(`${table}.${column[1] ?? ""}`);
  }
  return columns.sort((a, b) => a.localeCompare(b));
}

describe("a city's rename", () => {
  it("moves every column that names a city", () => {
    const moved = CITY_COLUMNS.map(([table, column]) => `${table}.${column}`).sort((a, b) => a.localeCompare(b));
    expect(moved).toEqual(cityColumns());
  });
});
