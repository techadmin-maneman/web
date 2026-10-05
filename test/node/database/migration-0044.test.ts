// Migration 0044: the hand-offs between surfaces, and the messages people are owed
// (docs/decisions/0074-hand-offs-and-messages.md). Applied to a database holding
// rows, as staging's does, and held to what the code already deployed writes.
// Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0044_")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

/** Every migration before this one, with a friend fitted through an invite and three visits closed. */
function before(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('referrer', '${AT}', '+919810000001', 'Rohit Malhotra');
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('friend', '${AT}', '+919810000002', ' Karan Bhatia ');
    INSERT INTO people (id, created_at, mobile_e164, name, erased_at)
      VALUES ('erased', '${AT}', 'erased:erased', 'Erased', '${AT}');
    INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM7K2Q', 'referrer', '${AT}', '${AT}');
    INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
      updated_at) VALUES ('r1', 'RM7K2Q', 'friend', '${AT}', 'consultation', 'granted', '${AT}', '${AT}');
    INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state, created_at,
      updated_at) VALUES ('r2', 'RM7K2Q', 'erased', '${AT}', 'consultation', 'granted', '${AT}', '${AT}');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'friend', 'first_fit', 'completed', 'Completed', '${AT}', '${AT}', '${AT}'),
             ('a2', 'ap-2', 'friend', 'service', 'terminated', 'Terminated', '${AT}', '${AT}', '${AT}'),
             ('a3', 'ap-3', 'friend', 'service', 'terminated', 'Terminated', '${AT}', '${AT}', '${AT}');
    INSERT INTO visits (id, appointment_id, duration_minutes, outcome, partial_reason, updated_at)
      VALUES ('v1', 'a1', 150, 'done', NULL, '${AT}'),
             ('v2', 'a2', 40, 'partial', 'client_unwell', '${AT}'),
             ('v3', 'a3', NULL, 'partial', 'no_show', '${AT}');
  `);
  return db;
}

function migrated(): DatabaseSync {
  const db = before();
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

describe("migration 0044", () => {
  it("records a no-show kept as a partial visit as a no-show, and keeps every other visit as it was", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, duration_minutes, outcome, partial_reason FROM visits ORDER BY id").all()).toEqual([
      { id: "v1", duration_minutes: 150, outcome: "done", partial_reason: null },
      { id: "v2", duration_minutes: 40, outcome: "partial", partial_reason: "client_unwell" },
      { id: "v3", duration_minutes: null, outcome: "no_show", partial_reason: null },
    ]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("still takes a visit as the deployed code writes it, and one visit an appointment", () => {
    const db = migrated();
    db.exec(`INSERT INTO appointments (id, fsm_id, status, fsm_status, fsm_modified_at, synced_at)
      VALUES ('a4', 'ap-4', 'terminated', 'Terminated', '${AT}', '${AT}')`);
    const write = db.prepare(
      `INSERT INTO visits (id, appointment_id, outcome, partial_reason, updated_at) VALUES (?, 'a4', ?, ?, '${AT}')
       ON CONFLICT (appointment_id) DO UPDATE SET outcome = excluded.outcome, partial_reason = excluded.partial_reason`,
    );
    write.run("v4", "partial", "no_show");
    write.run("v5", "no_show", null);
    expect(db.prepare("SELECT outcome FROM visits WHERE appointment_id = 'a4'").all()).toEqual([
      { outcome: "no_show" },
    ]);
    expect(() => write.run("v6", "gone", null)).toThrow();
    db.close();
  });

  it("keeps the first name of a friend already granted credits, and none for one erased", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, friend_first_name FROM referral_attributions ORDER BY id").all()).toEqual([
      { id: "r1", friend_first_name: "Karan" },
      { id: "r2", friend_first_name: null },
    ]);
    db.close();
  });

  it("keeps one arrival notice a visit", () => {
    const db = migrated();
    const notice = db.prepare(
      `INSERT INTO outbound_messages (id, created_at, person_id, kind, subject_kind, subject_id, state)
       VALUES (?, '${AT}', 'friend', 'arrival_notice', 'appointment', 'a1', 'queued')`,
    );
    notice.run("m1");
    expect(() => notice.run("m2")).toThrow();
    db.close();
  });
});
