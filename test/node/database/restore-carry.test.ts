// How the carry-back reads an export's schema. test/worker/platform/restore-carry.test.ts runs it on the real one.

import { describe, expect, it } from "vitest";
import { carryBack as carryBackWith, createTablesIn } from "../../../scripts/lib/restore-carry.ts";
import { keysOf } from "../../../scripts/lib/schema-keys.ts";

const lines = (...statements: string[]) => statements.join("\n");

const EXPORT = lines(
  "PRAGMA defer_foreign_keys=TRUE;",
  'CREATE TABLE IF NOT EXISTS "d1_migrations"(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE);',
  `INSERT INTO "d1_migrations" ("id","name") VALUES(1,'0001.sql');`,
  "CREATE TABLE deployment_identity (id INTEGER PRIMARY KEY, database_name TEXT NOT NULL);",
  `INSERT INTO "deployment_identity" ("id","database_name") VALUES(1,'maneman-staging');`,
  "CREATE TABLE maintenance (id INTEGER PRIMARY KEY, reason TEXT NOT NULL);",
  `INSERT INTO "maintenance" ("id","reason") VALUES(1,'restoring D1');`,
  "CREATE TABLE people (",
  "  id TEXT PRIMARY KEY,",
  "  name TEXT NOT NULL",
  ");",
  `INSERT INTO "people" ("id","name") VALUES('p1',replace('Arjun\\nD''Souza','\\n',char(10)));`,
  'CREATE TABLE IF NOT EXISTS "consents" (id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people (id));',
  `INSERT INTO "consents" ("id","person_id") VALUES('c1','p1');`,
  "CREATE TABLE stock (code TEXT PRIMARY KEY, quantity INTEGER NOT NULL);",
  "CREATE TABLE balances (code TEXT PRIMARY KEY, quantity INTEGER NOT NULL);",
  `INSERT INTO "balances" ("code","quantity") VALUES('strip',100);`,
  "DELETE FROM sqlite_sequence;",
  `INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);`,
  "CREATE INDEX people_by_name ON people (name);",
  // No BEFORE: a trigger's default.
  "CREATE TRIGGER consents_kept DELETE ON consents",
  "BEGIN",
  "  SELECT RAISE(ABORT, 'consents are append-only');",
  "END;",
  "CREATE TRIGGER stock_counted AFTER INSERT ON stock",
  "BEGIN",
  "  INSERT INTO balances (code, quantity) VALUES (NEW.code, NEW.quantity)",
  "  ON CONFLICT (code) DO UPDATE SET quantity = balances.quantity + excluded.quantity;",
  "END;",
);

/** The carry-back, with the keys the runbook's script reads from the export. */
const carryBack = (exported: string, leave?: readonly string[]) =>
  carryBackWith(exported, keysOf(createTablesIn(exported)), leave);

describe("the carry-back file", () => {
  it("reads which tables refuse a delete and which a trigger writes to", () => {
    const carry = carryBack(EXPORT);
    expect(carry.addOnly).toEqual(["consents"]);
    expect(carry.writtenByTriggers).toEqual(["balances"]);
    expect(carry.matched).toEqual(["people", "stock", "balances"]);
  });

  it("never touches the migrations, the database's identity, the maintenance switch or SQLite's own tables", () => {
    const text = carryBack(EXPORT).statements.join("\n");
    for (const table of ["d1_migrations", "deployment_identity", "maintenance", "sqlite_sequence"]) {
      expect(text).not.toContain(`"${table}"`);
    }
  });

  it("matches each table after those it points at, deletes what is gone, and matches trigger-written tables last", () => {
    const statements = carryBack(EXPORT).statements;
    const at = (start: string) => statements.findIndex((statement) => statement.startsWith(start));
    // The rows land first in bare copies, which no key, check or trigger watches.
    expect(statements.slice(0, 6)).toEqual([
      'CREATE TABLE "restore_carry_people" AS SELECT * FROM "people" WHERE 0;',
      'CREATE TABLE "restore_carry_consents" AS SELECT * FROM "consents" WHERE 0;',
      'CREATE TABLE "restore_carry_balances" AS SELECT * FROM "balances" WHERE 0;',
      `INSERT INTO "restore_carry_people" ("id","name") VALUES('p1',replace('Arjun\\nD''Souza','\\n',char(10)));`,
      `INSERT INTO "restore_carry_consents" ("id","person_id") VALUES('c1','p1');`,
      `INSERT INTO "restore_carry_balances" ("code","quantity") VALUES('strip',100);`,
    ]);
    // A table's rows changed to match, then added, in plain statements its triggers' own conflict handling still holds in.
    expect(statements).toContain(
      'UPDATE "people" SET "name" = copy."name" FROM "restore_carry_people" AS copy ' +
        'WHERE "people"."id" = copy."id" AND ("people"."name" IS NOT copy."name");',
    );
    expect(statements).toContain(
      'INSERT INTO "people" ("id", "name") SELECT "id", "name" FROM "restore_carry_people" AS copy ' +
        'WHERE NOT EXISTS (SELECT 1 FROM "people" WHERE "people"."id" = copy."id");',
    );
    expect(at('INSERT INTO "people"')).toBeLessThan(at('INSERT INTO "consents"'));
    // Gone since <T>: deleted, but never from a table that refuses a delete; a table the export has empty, emptied.
    expect(statements).toContain('DELETE FROM "people" WHERE ("id") NOT IN (SELECT "id" FROM "restore_carry_people");');
    expect(statements).toContain('DELETE FROM "stock";');
    expect(statements.some((statement) => statement.startsWith('DELETE FROM "consents"'))).toBe(false);
    // The tables triggers write to are matched again once every other table is.
    expect(statements.findLastIndex((statement) => statement.startsWith('INSERT INTO "balances"'))).toBeGreaterThan(
      at('DELETE FROM "people"'),
    );
    expect(statements.slice(-3)).toEqual([
      'DROP TABLE "restore_carry_people";',
      'DROP TABLE "restore_carry_consents";',
      'DROP TABLE "restore_carry_balances";',
    ]);
  });

  it("leaves the tables named as they were", () => {
    const carry = carryBack(EXPORT, ["people"]);
    expect(carry.left).toEqual(["people"]);
    expect(carry.statements.join("\n")).not.toContain('"people"');
  });

  it("refuses to leave a table the export does not have", () => {
    expect(() => carryBack(EXPORT, ["peoples"])).toThrow("not a table in the export: peoples");
  });

  it("refuses an export where a trigger writes to a table that refuses a delete", () => {
    const writesToConsents = lines(
      EXPORT,
      "CREATE TRIGGER people_consented AFTER INSERT ON people",
      "BEGIN",
      "  INSERT OR IGNORE INTO consents (id, person_id) VALUES (NEW.id, NEW.id);",
      "END;",
    );
    expect(() => carryBack(writesToConsents)).toThrow("consents is only ever added to, and a trigger on people");
  });

  it("counts a trigger's UPDATE and DELETE as writes, but not an upsert's DO UPDATE", () => {
    const moreTriggers = lines(
      EXPORT,
      "CREATE TABLE notes (id TEXT PRIMARY KEY);",
      "CREATE TRIGGER people_renamed AFTER UPDATE OF name ON people",
      "BEGIN",
      "  UPDATE stock SET quantity = 0 WHERE code = NEW.id;",
      "  DELETE FROM notes WHERE id = OLD.id;",
      "END;",
    );
    expect(carryBack(moreTriggers).writtenByTriggers).toEqual(["stock", "balances", "notes"]);
  });

  it("refuses a trigger it cannot read rather than guess", () => {
    const unreadable = lines(EXPORT, "CREATE TRIGGER odd INSTEAD OF something_else;");
    expect(() => carryBack(unreadable)).toThrow("a trigger the carry-back cannot read");
  });
});
