// How the carry-back reads an export's schema. test/worker/restore-carry.test.ts runs it on the real one.

import { describe, expect, it } from "vitest";
import { carryBack } from "../../scripts/lib/restore-carry.ts";

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
  'CREATE TABLE IF NOT EXISTS "consents" (id TEXT PRIMARY KEY, person_id TEXT NOT NULL);',
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

describe("the carry-back file", () => {
  it("reads which tables refuse a delete and which a trigger writes to", () => {
    const carry = carryBack(EXPORT);
    expect(carry.addOnly).toEqual(["consents"]);
    expect(carry.writtenByTriggers).toEqual(["balances"]);
    expect(carry.rewritten).toEqual(["people", "stock"]);
  });

  it("never touches the migrations, the database's identity, the maintenance switch or SQLite's own tables", () => {
    const text = carryBack(EXPORT).statements.join("\n");
    for (const table of ["d1_migrations", "deployment_identity", "maintenance", "sqlite_sequence"]) {
      expect(text).not.toContain(`"${table}"`);
    }
  });

  it("empties and writes again, adds where a delete is refused, and writes the trigger-written tables last", () => {
    expect(carryBack(EXPORT).statements).toEqual([
      "PRAGMA defer_foreign_keys = true;",
      'DELETE FROM "people";',
      'DELETE FROM "stock";',
      `INSERT INTO "people" ("id","name") VALUES('p1',replace('Arjun\\nD''Souza','\\n',char(10)));`,
      `INSERT INTO "consents" ("id","person_id") VALUES('c1','p1') ON CONFLICT DO UPDATE SET "id" = excluded."id", ` +
        `"person_id" = excluded."person_id" WHERE "id" IS NOT excluded."id" OR "person_id" IS NOT excluded."person_id";`,
      'DELETE FROM "balances";',
      `INSERT INTO "balances" ("code","quantity") VALUES('strip',100);`,
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
