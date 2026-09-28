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
    const problems = checkMigrations([create("0001_a.sql", "CREATE TABLE a (id INTEGER);")], { atBase });
    expect(problems[0]).toContain("0001_a.sql: applied migrations must not be edited");
    expect(problems[1]).toBe("0002_b.sql: applied migrations must not be deleted");
  });

  // A migration the deploy refused and rolled back has reached nothing, so there is
  // nothing for a later migration to correct and the next deploy fails on the same
  // statement. It may be withdrawn, and only withdrawn.
  it("allows a migration that reached nothing to be withdrawn", () => {
    const atBase = new Map([["0001_a.sql", "CREATE TABLE a (id TEXT);"]]);
    const withdrawn = [
      "-- withdrawn: deploy-staging run 1234 refused it, and it has been applied nowhere.",
      "SELECT 1;",
    ];
    expect(checkMigrations([create("0001_a.sql", withdrawn.join("\n"))], { atBase })).toEqual([]);
  });

  it("refuses a withdrawal that still does something, or that names no run", () => {
    const atBase = new Map([["0001_a.sql", "CREATE TABLE a (id TEXT);"]]);
    const stillDoes = ["-- withdrawn: run 1234 refused it", "CREATE TABLE c (id TEXT);"].join("\n");
    expect(checkMigrations([create("0001_a.sql", stillDoes)], { atBase })[0]).toContain("must not be edited");
    const unnamed = ["-- withdrawn:", "SELECT 1;"].join("\n");
    expect(checkMigrations([create("0001_a.sql", unnamed)], { atBase })[0]).toContain("must not be edited");
  });

  it("refuses CASE inside a trigger's body, which remote D1 refuses, and accepts it elsewhere", () => {
    const trigger = (body: string) =>
      `CREATE TRIGGER t_added AFTER INSERT ON t
BEGIN
  UPDATE totals SET n = ${body};
END;`;
    expect(checkMigrations([create("0001_x.sql", trigger("CASE WHEN NEW.a THEN 1 ELSE 0 END"))])).toEqual([
      "0001_x.sql: CASE inside the body of trigger t_added; remote D1 refuses it (migration 0052), use iif()",
    ]);
    expect(checkMigrations([create("0001_x.sql", trigger("iif(NEW.a, 1, 0)"))])).toEqual([]);
    expect(checkMigrations([create("0001_x.sql", "SELECT CASE WHEN 1 THEN 2 END;")])).toEqual([]);
    expect(
      checkMigrations([
        create(
          "0001_x.sql",
          `-- a CASE in a comment
${trigger("1")}`,
        ),
      ]),
    ).toEqual([]);
  });
});
