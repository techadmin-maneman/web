// Migration 0069: the Staff list, applied to a database whose audit log already holds ops calls, as staging's does.
// Nobody who used the console may be locked out by it, and a service token is never listed as a person. Every address
// and ID is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0069_")) ?? "";

const AT = "2026-10-01T06:30:00.000Z";

function migrated(history: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(history);
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

const call = (actorKind: string, actor: string, surface = "ops") =>
  `INSERT INTO audit_log (at, surface, actor_kind, actor, action) VALUES ('${AT}', '${surface}', '${actorKind}', '${actor}', 'ops.call');`;

const STAGING_LIKE = [
  call("staff", "owner@maneman.in"),
  call("staff", "owner@maneman.in"),
  call("staff", "founder@maneman.in"),
  call("service", "a1b2c3d4.access"),
  call("service", "a1b2c3d4.access"),
  // A client and a technician act on other surfaces; neither is staff.
  call("client", "person-1", "client"),
  call("technician", "technician-1", "tech"),
].join("\n");

describe("migration 0069", () => {
  it("lists each person who used the console, with every department at MANAGE nationally", () => {
    const db = migrated(STAGING_LIKE);
    expect(db.prepare("SELECT email, active FROM staff ORDER BY email").all()).toEqual([
      { email: "founder@maneman.in", active: 1 },
      { email: "owner@maneman.in", active: 1 },
    ]);
    const grants = db
      .prepare(
        "SELECT department, level, geography, place FROM staff_grants WHERE email = 'owner@maneman.in' ORDER BY department",
      )
      .all();
    expect(grants).toEqual(
      ["admin", "customer_care", "finance", "growth", "operations"].map((department) => ({
        department,
        level: "manage",
        geography: "national",
        place: null,
      })),
    );
  });

  it("keeps each service token's access by its list, and never lists one as a person", () => {
    const db = migrated(STAGING_LIKE);
    expect(db.prepare("SELECT client_id FROM staff_service_tokens").all()).toEqual([{ client_id: "a1b2c3d4.access" }]);
    expect(db.prepare("SELECT 1 FROM staff WHERE email LIKE '%.access'").all()).toEqual([]);
  });

  it("starts with the list not enforced, and lists nobody where nobody used the console", () => {
    const db = migrated("");
    expect(db.prepare("SELECT enforced FROM staff_access_mode").all()).toEqual([{ enforced: 0 }]);
    expect(db.prepare("SELECT COUNT(*) AS people FROM staff").get()).toEqual({ people: 0 });
  });

  it("puts NCR's five cities in the NCR zone, and the cities not served in none", () => {
    const db = migrated("");
    expect(db.prepare("SELECT name, zone FROM cities ORDER BY sort").all()).toEqual([
      { name: "Gurgaon", zone: "NCR" },
      { name: "Delhi", zone: "NCR" },
      { name: "Noida", zone: "NCR" },
      { name: "Faridabad", zone: "NCR" },
      { name: "Ghaziabad", zone: "NCR" },
      { name: "Mumbai", zone: null },
      { name: "Bengaluru", zone: null },
    ]);
  });

  it("refuses a grant that names no place but is not national, and an e-mail not in lower case", () => {
    const db = migrated(STAGING_LIKE);
    const grant = (geography: string, place: string | null) => () =>
      db
        .prepare(
          `INSERT INTO staff_grants (email, department, level, geography, place, granted_by, granted_at)
           VALUES ('owner@maneman.in', 'finance', 'view', ?, ?, 'owner@maneman.in', '${AT}')`,
        )
        .run(geography, place);
    expect(grant("city", null)).toThrow(/CHECK/);
    expect(grant("national", "Delhi")).toThrow(/CHECK/);
    expect(grant("city", "Delhi")).not.toThrow();
    expect(() =>
      db.prepare("INSERT INTO staff (email, active, added_by, added_at) VALUES ('Lead@ManeMan.in', 1, 'x', ?)").run(AT),
    ).toThrow(/CHECK/);
  });
});
