// Migration 0064: a client's hair profile (docs/decisions/0106-a-clients-hair-profile.md), applied to a database that
// already holds a client, a visit and a technician, as staging's does. Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0064_")) ?? "";

const AT = "2026-10-01T06:30:00.000Z";

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client');
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'p1', 'consultation', 'in_progress', 'In Progress', '${AT}', '${AT}', '${AT}');
  `);
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

/** A statement, run as expect() runs what it is to see throw. */
const running = (db: DatabaseSync, sql: string) => () => {
  db.exec(sql);
};

/** A version of the profile as the technician's phone records it, at visit a1 under its event ID. */
function version(db: DatabaseSync, id: string, eventId: string | null = "event-1"): void {
  db.prepare(
    `INSERT INTO hair_profiles (id, person_id, appointment_id, event_id, technician_id, created_at, norwood_stage,
       head_circumference_cm, colour, grey_percent, density_percent, product, attachment, remedies, transplant_year,
       skin_and_allergies)
     VALUES (?, 'p1', 'a1', ?, 't1', ?, 'IV', 57.5, '1B', 20, 120, 'standard', 'tape', '["minoxidil"]', NULL,
       'Dry at the crown')`,
  ).run(id, eventId, AT);
}

describe("migration 0064", () => {
  it("keeps a version of the profile once for each of the phone's events at a visit", () => {
    const db = migrated();
    version(db, "v1");
    expect(() => {
      version(db, "v2");
    }).toThrow(/UNIQUE/);
    version(db, "v3", "event-2");
    // Ops' corrections name no visit and no event, and as many may be kept as are made.
    for (const id of ["o1", "o2"]) {
      db.prepare(
        "INSERT INTO hair_profiles (id, person_id, staff, created_at, colour) VALUES (?, 'p1', 'ops@maneman.test', ?, '2')",
      ).run(id, AT);
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM hair_profiles").get()).toEqual({ n: 4 });
  });

  it("names who recorded each version: a technician or a member of staff, never both or neither", () => {
    const db = migrated();
    const recordedBy = (technician: string | null, staff: string | null) =>
      db
        .prepare(
          "INSERT INTO hair_profiles (id, person_id, technician_id, staff, created_at) VALUES (?, 'p1', ?, ?, ?)",
        )
        .run(crypto.randomUUID(), technician, staff, AT);
    expect(() => recordedBy(null, null)).toThrow(/CHECK/);
    expect(() => recordedBy("t1", "ops@maneman.test")).toThrow(/CHECK/);
  });

  it("never changes a version, nor deletes one: it may only be blanked, as an erasure does", () => {
    const db = migrated();
    version(db, "v1");
    expect(running(db, "UPDATE hair_profiles SET colour = '2' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "UPDATE hair_profiles SET person_id = 'p2' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "UPDATE hair_profiles SET created_at = 'now' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "DELETE FROM hair_profiles WHERE id = 'v1'")).toThrow(/kept/);

    db.exec(`UPDATE hair_profiles SET norwood_stage = NULL, head_circumference_cm = NULL, colour = NULL,
               grey_percent = NULL, density_percent = NULL, product = NULL, attachment = NULL, remedies = NULL,
               transplant_year = NULL, skin_and_allergies = NULL WHERE id = 'v1'`);
    expect(
      db.prepare("SELECT norwood_stage, colour, skin_and_allergies, technician_id FROM hair_profiles").get(),
    ).toEqual({ norwood_stage: null, colour: null, skin_and_allergies: null, technician_id: "t1" });
  });

  it("finds a person's versions, and a visit's, by an index", () => {
    const db = migrated();
    const planOf = (sql: string) => JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all());
    expect(planOf("SELECT * FROM hair_profiles WHERE person_id = 'p1' ORDER BY created_at DESC")).toContain(
      "hair_profiles_by_person",
    );
    expect(planOf("SELECT 1 FROM hair_profiles WHERE appointment_id = 'a1'")).toContain("hair_profiles_by_event");
  });
});
