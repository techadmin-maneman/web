// Migration 0228: each technician's own reach in minutes becomes the straight-line km it covered, and so does the
// business's, where ops set one (docs/decisions/0289-who-takes-a-visit.md). Every figure here is made up.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_technician_radius.sql");

function aTechnician(db: ReturnType<typeof databaseBefore>, id: string, reachMin: number | null) {
  db.prepare(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at, reach_min)
     VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, '2026-11-20T06:00:00.000Z', ?2)`,
  ).run(id, reachMin);
}

describe("migration 0228", () => {
  it("turns each technician's own reach into km, 45 minutes into 10, and leaves the rest to the setting", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    aTechnician(db, "t1", 45);
    aTechnician(db, "t2", 180);
    aTechnician(db, "t3", 10);
    aTechnician(db, "t4", null);
    apply(db, THIS);
    expect(db.prepare("SELECT id, radius_km FROM technicians ORDER BY id").all()).toEqual([
      { id: "t1", radius_km: 10 },
      { id: "t2", radius_km: 49 },
      { id: "t3", radius_km: 1 },
      { id: "t4", radius_km: null },
    ]);
    db.close();
  });

  it("turns the business's reach into its radius, kept by who set it, and adds none where none was set", () => {
    const set = databaseBefore(THIS);
    set
      .prepare(
        `INSERT INTO ops_settings (name, value, set_by, set_at)
         VALUES ('technician_reach_min', '60', 'ops@localhost', '2026-11-18T06:00:00.000Z')`,
      )
      .run();
    apply(set, THIS);
    expect(set.prepare("SELECT value, set_by FROM ops_settings WHERE name = 'technician_radius_km'").all()).toEqual([
      { value: "14", set_by: "ops@localhost" },
    ]);
    set.close();

    const unset = databaseBefore(THIS);
    apply(unset, THIS);
    expect(unset.prepare("SELECT name FROM ops_settings WHERE name = 'technician_radius_km'").all()).toEqual([]);
    unset.close();
  });
});
