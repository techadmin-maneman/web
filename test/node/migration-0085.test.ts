// Migration 0085 links each check-in that passed to the job event it landed as, so a no-show's wait runs only from a
// check-in whose event still stands, and a check-in sent again is answered from its own row (FLD-11). Every name and
// number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

const AT = "2026-09-21T07:30:00.000Z";
const LATER = "2026-09-21T07:45:00.000Z";

const checkIn = (id: string, technician: string, at: string, passed: 0 | 1) =>
  `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
   VALUES ('${id}', 'a1', '${technician}', '${at}', 28.3988, 77.07, 89, 200, ${String(passed)}, '${at}');`;

const event = (id: string, technician: string, at: string, superseded: 0 | 1) =>
  `INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
     superseded, updated_at)
   VALUES ('${id}', 'a1', 'phone-${id}', '${technician}', 'check_in', '{"at":"${at}","distance_m":89}', '${at}',
     '${at}', ${String(superseded)}, '${at}');`;

/**
 * Every migration before 0085, and the check-ins the deployed code wrote: one that landed and was sent again, one
 * that failed the geofence, one refused as superseded, and one by another technician.
 */
function beforeTheLink(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < "0085")) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(`
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}'),
             ('t2', 'resource-2', 'B Technician', 'BT', 1, 'Gurgaon', '+919810000008', '${AT}');
    INSERT INTO appointments (id, fsm_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'service', 'dispatched', 'Dispatched', '${AT}', '${AT}', '${AT}');
    ${event("e-landed", "t1", AT, 0)}
    ${checkIn("c-landed", "t1", AT, 1)}
    ${checkIn("c-sent-again", "t1", AT, 1)}
    ${checkIn("c-too-far", "t1", AT, 0)}
    ${event("e-refused", "t2", LATER, 1)}
    ${checkIn("c-refused", "t2", LATER, 1)}
    ${checkIn("c-no-event", "t2", AT, 1)}
  `);
  return db;
}

function migrated(): DatabaseSync {
  const db = beforeTheLink();
  db.exec("BEGIN");
  db.exec(readFileSync("migrations/0085_checkin_job_event.sql", "utf8"));
  db.exec("COMMIT");
  return db;
}

describe("migration 0085", () => {
  it("links the first row of each event's own time to it, and no other", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, job_event_id FROM checkins ORDER BY id").all()).toEqual([
      { id: "c-landed", job_event_id: "e-landed" },
      { id: "c-no-event", job_event_id: null },
      { id: "c-refused", job_event_id: "e-refused" },
      { id: "c-sent-again", job_event_id: null },
      { id: "c-too-far", job_event_id: null },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("links an event to one check-in at most", () => {
    const db = migrated();
    expect(() => {
      db.exec("UPDATE checkins SET job_event_id = 'e-landed' WHERE id = 'c-sent-again'");
    }).toThrow(/UNIQUE/);
    db.close();
  });

  it("takes a check-in as the deployed code writes it, with no event named", () => {
    const db = migrated();
    db.exec(checkIn("c-deployed", "t1", LATER, 1));
    db.exec(checkIn("c-deployed-again", "t1", LATER, 1));
    expect(db.prepare("SELECT COUNT(*) AS n FROM checkins WHERE job_event_id IS NULL").get()).toEqual({ n: 5 });
    db.close();
  });
});
