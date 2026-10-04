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

  it("accepts a migration renumbered before any environment applied it, and only under its new name", () => {
    const atBase = new Map([["0077_consents_shown.sql", "ALTER TABLE t ADD COLUMN a TEXT;"]]);
    const renumbered = create("0078_consents_shown.sql", "ALTER TABLE t ADD COLUMN a TEXT;");
    expect(checkMigrations([renumbered], { atBase }).filter((problem) => problem.includes("deleted"))).toEqual([]);
    expect(checkMigrations([create("0078_other.sql")], { atBase })).toContain(
      "0077_consents_shown.sql: applied migrations must not be deleted",
    );
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

// From 0101 on: those before it have run, and are never edited.
describe("how a new migration is written", () => {
  const applied = Array.from({ length: 100 }, (_, index) => create(`${String(index + 1).padStart(4, "0")}_t.sql`));
  const check = (sql: string) => checkMigrations([...applied, create("0101_new.sql", sql)]);

  it("opens with at most five comment lines", () => {
    const header = (lines: number) => `${"-- why\n".repeat(lines)}CREATE TABLE u (id TEXT);`;
    expect(check(header(5))).toEqual([]);
    expect(check(header(6))).toEqual(["0101_new.sql: 6 comment lines open it; at most 5, the rest in its ADR"]);
  });

  it("names no open point by number, which renumbering makes wrong", () => {
    expect(check("-- docs/open-points.md, item 39\nCREATE TABLE u (id TEXT);")).toEqual([
      "0101_new.sql: names an open point by number, which renumbering makes wrong",
    ]);
    expect(check("-- the open points list the owner's answer\nCREATE TABLE u (id TEXT);")).toEqual([]);
  });

  it("holds no one environment's test data", () => {
    expect(check("UPDATE people SET test_record = 1 WHERE name = 'Staging test';")).toEqual([
      "0101_new.sql: holds one environment's test data; write it from a script run there",
    ]);
  });

  it.each([
    "UPDATE people SET test_record = 0;",
    "INSERT INTO people_copy SELECT * FROM people;",
    "INSERT OR IGNORE INTO people_copy (id) SELECT id FROM people;",
  ])("estimates the writes of a backfill of a whole table: %s", (sql) => {
    expect(check(sql)).toEqual([
      '0101_new.sql: backfills a whole table; estimate its writes in a "-- backfill:" line (docs/migrations.md)',
    ]);
    expect(check(`-- backfill: about 2,000 rows x (1 + 2 indexes)\n${sql}`)).toEqual([]);
  });

  it("needs no estimate for a change to some rows, or for a migration already applied", () => {
    expect(check("UPDATE people SET test_record = 0 WHERE id = 'p1';")).toEqual([]);
    expect(checkMigrations([create("0001_old.sql", "UPDATE people SET test_record = 0;")])).toEqual([]);
  });
});
