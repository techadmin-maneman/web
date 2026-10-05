// Migration 0035 keeps the phone's own claim beside a check-in's time, and lets
// a check-in with nothing to measure against hold no distance rather than a
// filler 0 (docs/decisions/0065-a-technicians-writes-reach-fsm.md). checkins is
// referenced by no_show_cases, so the column is swapped in place, never rebuilt
// (migration 0031). Every name and number is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore } from "./migrations.ts";

const AT = "2026-09-21T06:30:00.000Z";

/** Every migration before 0035, with a measured and an unmeasured check-in, and a case on the second. */
function beforeTheSwap(): DatabaseSync {
  const db = databaseBefore("0035");
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client');
    INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng)
      VALUES ('addr-1', 'p1', '${AT}', 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.398, 77.07);
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'p1', 'service', 'dispatched', 'Dispatched', '${AT}', '${AT}', '${AT}');
    INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, distance_m, radius_m, passed,
      created_at) VALUES ('c1', 'a1', 't1', 'addr-1', '${AT}', 28.3988, 77.07, 89, 200, 1, '${AT}');
    INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, distance_m, radius_m, passed,
      created_at) VALUES ('c2', 'a1', 't1', NULL, '${AT}', 28.3988, 77.07, 0, 200, 1, '${AT}');
    INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
      VALUES ('n1', 'c2', 'a1', '${AT}', '${AT}', '${AT}');
  `);
  return db;
}

function migrated(): DatabaseSync {
  const db = beforeTheSwap();
  apply(db, "0035_checkin_times_and_distance.sql");
  return db;
}

describe("migration 0035", () => {
  it("clears the filler 0 of a check-in that measured nothing, and keeps a real distance", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, distance_m FROM checkins ORDER BY id").all()).toEqual([
      { id: "c1", distance_m: 89 },
      { id: "c2", distance_m: null },
    ]);
    db.close();
  });

  it("leaves the case that points at a check-in pointing at it", () => {
    const db = migrated();
    expect(db.prepare("SELECT checkin_id FROM no_show_cases").get()).toEqual({ checkin_id: "c2" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("takes a check-in as the deployed code writes it, and one with nothing measured", () => {
    const db = migrated();
    db.exec(`INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, distance_m, radius_m,
      passed, created_at) VALUES ('c3', 'a1', 't1', NULL, '${AT}', 28.3988, 77.07, 0, 200, 1, '${AT}')`);
    db.exec(`INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, claimed_at, lat, lng, distance_m,
      radius_m, passed, created_at) VALUES ('c4', 'a1', 't1', NULL, '${AT}', '${AT}', 28.3988, 77.07, NULL, 200, 1,
      '${AT}')`);
    expect(() => {
      db.exec(`INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed,
        created_at) VALUES ('c5', 'a1', 't1', '${AT}', 28.3988, 77.07, -1, 200, 1, '${AT}')`);
    }).toThrow(/CHECK/);
    db.close();
  });
});
