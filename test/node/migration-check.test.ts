import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMigrations } from "../../scripts/lib/migration-check.ts";

const create = (name: string, sql = "CREATE TABLE t (id TEXT);") => ({ name, sql });

describe("migration check", () => {
  it("the committed migrations pass", () => {
    const files = readdirSync("migrations").map((name) => ({ name, sql: readFileSync(`migrations/${name}`, "utf8") }));
    expect(checkMigrations(files)).toEqual([]);
  });

  it("requires NNNN_snake_case.sql names numbered without gaps", () => {
    expect(checkMigrations([create("0001_a.sql"), create("0003_b.sql")])).toEqual([
      "0003_b.sql: expected migration number 0002; numbers must be contiguous",
    ]);
    expect(checkMigrations([create("0001-Bad Name.sql")])).toEqual([
      "0001-Bad Name.sql: name must be NNNN_snake_case.sql",
    ]);
  });

  it.each([
    "DROP TABLE leads;",
    "ALTER TABLE leads DROP COLUMN city;",
    "ALTER TABLE leads RENAME COLUMN city TO town;",
    "ALTER TABLE leads RENAME TO old_leads;",
    "drop view v;",
    "DELETE FROM leads;",
  ])("rejects a destructive statement without a contract annotation: %s", (sql) => {
    expect(checkMigrations([create("0001_x.sql", sql)])[0]).toMatch(/breaks the running version/);
  });

  it("accepts a contract step that names an existing ADR", () => {
    const sql = "-- contract: docs/decisions/0042-drop-city.md\nALTER TABLE leads DROP COLUMN city;";
    expect(checkMigrations([create("0001_x.sql", sql)], { adrExists: () => true })).toEqual([]);
    expect(checkMigrations([create("0001_x.sql", sql)], { adrExists: () => false })).toEqual([
      "0001_x.sql: contract annotation names docs/decisions/0042-drop-city.md, which does not exist",
    ]);
  });

  it("ignores destructive words inside comments", () => {
    expect(
      checkMigrations([create("0001_x.sql", "-- never DROP TABLE here\n/* DELETE FROM x */\nCREATE TABLE t (a);")]),
    ).toEqual([]);
  });

  it("rejects editing or deleting a migration that exists on the base branch", () => {
    const atBase = new Map([
      ["0001_a.sql", "CREATE TABLE a (id TEXT);"],
      ["0002_b.sql", "CREATE TABLE b (id TEXT);"],
    ]);
    expect(checkMigrations([create("0001_a.sql", "CREATE TABLE a (id INTEGER);")], { atBase })).toEqual([
      "0001_a.sql: applied migrations must not be edited; add a new migration",
      "0002_b.sql: applied migrations must not be deleted",
    ]);
  });
});
