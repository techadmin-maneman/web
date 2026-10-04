// Migration 0091: each service may carry one line clients read under its name, empty until ops write one.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.endsWith("_service_description.sql")) ?? "";

function throughThis(): DatabaseSync {
  expect(THIS).not.toBe("");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name <= THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  return db;
}

const describeService = (db: DatabaseSync, description: string | null) =>
  db.prepare("UPDATE services SET description = ?1 WHERE kind = 'service' AND tier = 'standard'").run(description);

describe("migration 0091", () => {
  it("leaves every service with no description, and takes one line of up to 160 characters", () => {
    const db = throughThis();
    expect(db.prepare("SELECT COUNT(*) AS described FROM services WHERE description IS NOT NULL").get()).toEqual({
      described: 0,
    });

    describeService(db, "Refit, clean, trim, at home.");
    describeService(db, "A".repeat(160));
    describeService(db, null);
    expect(() => describeService(db, "")).toThrow(/CHECK constraint failed/);
    expect(() => describeService(db, "A".repeat(161))).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
