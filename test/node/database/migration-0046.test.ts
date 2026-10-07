// Migration 0046: the technicians the FSM sync does not own (docs/decisions/0052-technician-sessions.md).
// Applied to a database holding a technician FSM lists, the tester's and a staging proof's, as staging's
// does. Nine tables point at technicians, so it gains its column in place and is never rebuilt
// (docs/migrations.md, rule 4). Every name and number is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("0046_");

const AT = "2026-09-21T06:30:00.000Z";

/** Every migration before this one, with four technicians, a job on the tester's, and their phone. */
function before(): DatabaseSync {
  const db = databaseBefore(THIS);
  db.exec(`
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at) VALUES
      ('t-fsm', '8229000000304400', 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', '${AT}'),
      ('t-left', '8229000000304401', 'Vikram Sethi', 'VS', 0, 'Gurgaon', '+919810000006', '${AT}'),
      ('t-tester', 'tech-tester-522a73f9', 'Test Technician', 'TT', 0, 'Gurgaon', '+919810000008', '${AT}'),
      ('t-proof', 'tech-proof-1c2d3e4f', 'Staging Technician', 'ST', 1, NULL, '+919810000007', '${AT}');
    INSERT INTO appointments (id, fsm_id, technician_id, type, status, fsm_status, window_start, fsm_modified_at,
      synced_at) VALUES ('a1', 'tech-tester-522a73f9-a1', 't-tester', 'service', 'scheduled', 'Scheduled', '${AT}',
      '${AT}', '${AT}');
    INSERT INTO technician_devices (id, technician_id, device_id, created_at, last_seen_at)
      VALUES ('d1', 't-tester', 'phone-1', '${AT}', '${AT}');
  `);
  return db;
}

function migrated(): DatabaseSync {
  const db = before();
  apply(db, THIS);
  return db;
}

describe("migration 0046", () => {
  it("marks the tester's and the proof's technicians as written by hand, and none that FSM wrote", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, hand_written FROM technicians ORDER BY id").all()).toEqual([
      { id: "t-fsm", hand_written: 0 },
      { id: "t-left", hand_written: 0 },
      { id: "t-proof", hand_written: 1 },
      { id: "t-tester", hand_written: 1 },
    ]);
    db.close();
  });

  // A tester's row the sync switched off stays off: whether it is laid again is the tester's to choose
  // (docs/technician-test-setup.md), so the migration marks it and changes nothing else.
  it("changes nothing else about any technician, and leaves what points at one pointing at it", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, active, mobile_e164 FROM technicians ORDER BY id").all()).toEqual([
      { id: "t-fsm", active: 1, mobile_e164: "+919810000009" },
      { id: "t-left", active: 0, mobile_e164: "+919810000006" },
      { id: "t-proof", active: 1, mobile_e164: "+919810000007" },
      { id: "t-tester", active: 0, mobile_e164: "+919810000008" },
    ]);
    expect(db.prepare("SELECT technician_id FROM appointments WHERE id = 'a1'").get()).toEqual({
      technician_id: "t-tester",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("takes a technician as the deployed code writes him, as one FSM wrote, and nothing but 0 or 1", () => {
    const db = migrated();
    db.exec(`INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t-new', '8229000000304402', 'Naveen Rao', 'NR', 1, 'Gurgaon', '+919810000005', '${AT}')`);
    expect(db.prepare("SELECT hand_written FROM technicians WHERE id = 't-new'").get()).toEqual({ hand_written: 0 });
    expect(() => {
      db.exec(`INSERT INTO technicians (id, fsm_id, name, initials, active, hand_written, updated_at)
        VALUES ('t-bad', 'tech-tester-00000000', 'Test Technician', 'TT', 1, 2, '${AT}')`);
    }).toThrow(/CHECK/);
    db.close();
  });
});
