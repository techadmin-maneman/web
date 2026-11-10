// Migration 0202: a consultation's expected use of the kit goes, and the head's measurements are filled in inches
// beside their centimetres, the table still held to a version blanked, never changed. Every name here is made up.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_consultation_rules_and_inches.sql");
const AT = "2026-11-01T00:00:00.000Z";

function staging() {
  const db = databaseBefore(THIS);
  db.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, '+919810000001', 'Rohit')").run(
    AT,
  );
  db.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, head_circumference_cm, front_to_nape_cm,
       ear_to_ear_cm, temple_to_temple_cm, base_width_in)
     VALUES ('v1', 'p1', 'ops@example.com', ?1, 57.5, 36, 33.5, NULL, 8),
            ('v2', 'p1', 'ops@example.com', ?1, 40, 50, 20, 34.1, NULL)`,
  ).run(AT);
  db.prepare(
    `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
     VALUES ('tape', 'Tape', 'strip', 100, ?1, ?1)`,
  ).run(AT);
  db.prepare(
    `INSERT INTO consumable_usage (visit_type, tier, consumable_code, quantity, set_by, set_at)
     VALUES ('consultation', 'standard', 'tape', 1, 'ops', ?1), ('service', 'standard', 'tape', 4, 'ops', ?1)`,
  ).run(AT);
  return db;
}

describe("migration 0202", () => {
  it("fills each head measurement in inches from its centimetres, to one decimal, and leaves none taken empty", () => {
    expect(THIS).not.toBe("");
    const db = staging();
    apply(db, THIS);

    expect(
      db
        .prepare(
          `SELECT id, head_circumference_in, front_to_nape_in, ear_to_ear_in, temple_to_temple_in,
             head_circumference_cm, base_width_in
           FROM hair_profiles ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "v1",
        head_circumference_in: 22.6,
        front_to_nape_in: 14.2,
        ear_to_ear_in: 13.2,
        temple_to_temple_in: null,
        head_circumference_cm: 57.5,
        base_width_in: 8,
      },
      {
        id: "v2",
        head_circumference_in: 15.7,
        front_to_nape_in: 19.7,
        ear_to_ear_in: 7.9,
        temple_to_temple_in: 13.4,
        head_circumference_cm: 40,
        base_width_in: null,
      },
    ]);
    db.close();
  });

  it("refuses a change to an inch column, and still lets an erasure blank every column", () => {
    const db = staging();
    apply(db, THIS);

    expect(() => db.prepare("UPDATE hair_profiles SET head_circumference_in = 23 WHERE id = 'v1'").run()).toThrow(
      /never changed, only blanked/,
    );
    db.prepare(
      `UPDATE hair_profiles SET head_circumference_in = NULL, front_to_nape_in = NULL, ear_to_ear_in = NULL,
         temple_to_temple_in = NULL, head_circumference_cm = NULL WHERE id = 'v1'`,
    ).run();
    expect(
      db.prepare("SELECT head_circumference_in, head_circumference_cm FROM hair_profiles WHERE id = 'v1'").get(),
    ).toEqual({ head_circumference_in: null, head_circumference_cm: null });
    db.close();
  });

  it("blanks each inch twin when the release before's erasure blanks the centimetres alone", () => {
    const db = staging();
    apply(db, THIS);

    db.prepare(
      `UPDATE hair_profiles SET head_circumference_cm = NULL, front_to_nape_cm = NULL, ear_to_ear_cm = NULL,
         temple_to_temple_cm = NULL, base_width_in = NULL WHERE id = 'v2'`,
    ).run();
    expect(
      db
        .prepare(
          `SELECT id, head_circumference_in, front_to_nape_in, ear_to_ear_in, temple_to_temple_in
           FROM hair_profiles ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "v1", head_circumference_in: 22.6, front_to_nape_in: 14.2, ear_to_ear_in: 13.2, temple_to_temple_in: null },
      { id: "v2", head_circumference_in: null, front_to_nape_in: null, ear_to_ear_in: null, temple_to_temple_in: null },
    ]);
    db.close();
  });

  it("takes away what a consultation was expected to use, and leaves every other service's", () => {
    const db = staging();
    apply(db, THIS);

    expect(db.prepare("SELECT visit_type, quantity FROM consumable_usage").all()).toEqual([
      { visit_type: "service", quantity: 4 },
    ]);
    db.close();
  });
});
