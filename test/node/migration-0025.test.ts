// Migration 0025 adds the field-operations tables (the plan's P2-M4). What the
// schema itself must hold, whatever the code around it does: a replayed job
// event lands once, a check-in records its distance whether it passed or not, a
// move carries a reason from the design's list, and no row points at a job, a
// technician or a device that is not there. D1 is SQLite, so this applies the
// real migration files to an in-memory SQLite database. Every name is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

const AT = "2026-09-21T06:30:00.000Z";

/** A migrated database holding one technician with one job to do. */
function seeded(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client')`);
  db.exec(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, '${AT}')`,
  );
  for (const [id, fsmId] of [
    ["job1", "fsm-1"],
    ["job2", "fsm-2"],
  ]) {
    db.exec(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, technician_id, fsm_modified_at,
         synced_at)
       VALUES ('${String(id)}', '${String(fsmId)}', 'p1', 'service', 'scheduled', 'Scheduled', 't1', '${AT}', '${AT}')`,
    );
  }
  return db;
}

const insertEvent = (db: DatabaseSync, job: string, eventId: string) =>
  db
    .prepare(
      `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
         updated_at)
       VALUES (?, ?, ?, 't1', 'outcome', '{"outcome":"done"}', ?, ?, ?)`,
    )
    .run(`${job}-${eventId}`, job, eventId, AT, AT, AT);

const insertCheckin = (db: DatabaseSync, id: string, distanceM: number, passed: number) =>
  db
    .prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
       VALUES (?, 'job1', 't1', ?, 28.4949, 77.0886, ?, 200, ?, ?)`,
    )
    .run(id, AT, distanceM, passed, AT);

let db: DatabaseSync;
beforeEach(() => {
  db = seeded();
});

describe("migration 0025", () => {
  it("lands a replayed job event once, and the same ID on another job as its own", () => {
    insertEvent(db, "job1", "device-event-1");
    expect(() => insertEvent(db, "job1", "device-event-1")).toThrow(/UNIQUE/);
    // Devices number their own events, so two phones may pick the same ID.
    insertEvent(db, "job2", "device-event-1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM job_events").get()).toEqual({ n: 2 });
  });

  it("opens a job event unwritten and unsuperseded, so the queue picks it up", () => {
    insertEvent(db, "job1", "device-event-1");
    expect(db.prepare("SELECT fsm_write_state, superseded FROM job_events").get()).toEqual({
      fsm_write_state: "pending",
      superseded: 0,
    });
    expect(() => {
      db.exec("UPDATE job_events SET fsm_write_state = 'maybe' WHERE event_id = 'device-event-1'");
    }).toThrow(/CHECK/);
  });

  it("keeps a check-in that failed the geofence, with the distance and the radius in force", () => {
    insertCheckin(db, "near", 42, 1);
    insertCheckin(db, "far", 900, 0);
    expect(db.prepare("SELECT id FROM checkins WHERE passed = 0").all()).toEqual([{ id: "far" }]);
    expect(() => insertCheckin(db, "impossible", -1, 0)).toThrow(/CHECK/);
  });

  it("opens a no-show case undecided, one per check-in", () => {
    insertCheckin(db, "near", 42, 1);
    const open = (id: string) =>
      db
        .prepare(
          `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
           VALUES (?, 'near', 'job1', ?, ?, ?)`,
        )
        .run(id, AT, "2026-09-21T06:45:00.000Z", AT);
    open("case1");
    expect(db.prepare("SELECT decision FROM no_show_cases").get()).toEqual({ decision: "undecided" });
    expect(() => open("case2")).toThrow(/UNIQUE/);
  });

  it("takes only a move reason from the design's list", () => {
    const move = (id: string, reason: string) =>
      db
        .prepare(
          `INSERT INTO dispatch_moves (id, appointment_id, was_technician_id, now_technician_id, reason, actor,
             created_at, updated_at)
           VALUES (?, 'job1', 't1', 't1', ?, 'ops@maneman.test', ?, ?)`,
        )
        .run(id, reason, AT, AT);
    move("m1", "zone_rebalance");
    expect(() => move("m2", "because")).toThrow(/CHECK/);
  });

  it("counts a consumable once per event, and refuses a quantity of none", () => {
    insertEvent(db, "job1", "device-event-1");
    const used = (id: string, name: string, quantity: number) =>
      db
        .prepare(
          `INSERT INTO consumables_used (id, appointment_id, job_event_id, name, quantity, created_at)
           VALUES (?, 'job1', 'job1-device-event-1', ?, ?, ?)`,
        )
        .run(id, name, quantity, AT);
    used("c1", "Adhesive", 2);
    used("c2", "Solvent", 1);
    expect(() => used("c3", "Adhesive", 1)).toThrow(/UNIQUE/);
    expect(() => used("c4", "Tape", 0)).toThrow(/CHECK/);
  });

  it("points every row at a job, a technician and a device that exist", () => {
    expect(() => insertEvent(db, "job404", "device-event-1")).toThrow(/FOREIGN KEY/);
    expect(() => {
      db.exec(
        `INSERT INTO technician_devices (id, technician_id, device_id, created_at, last_seen_at)
         VALUES ('d1', 't404', 'phone-1', '${AT}', '${AT}')`,
      );
    }).toThrow(/FOREIGN KEY/);
  });

  it("keeps one row per phone per technician, so a fresh login reuses it", () => {
    const device = (id: string, deviceId: string) =>
      db
        .prepare(
          `INSERT INTO technician_devices (id, technician_id, device_id, created_at, last_seen_at)
           VALUES (?, 't1', ?, ?, ?)`,
        )
        .run(id, deviceId, AT, AT);
    device("d1", "phone-1");
    device("d2", "phone-2");
    expect(() => device("d3", "phone-1")).toThrow(/UNIQUE/);
  });
});
