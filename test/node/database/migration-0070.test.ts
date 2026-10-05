// Migration 0070: the schema a visit booked without FSM needs, and Books' own Zoho client, applied to a database
// that already holds a mirrored visit and the Zoho tokens in use, as staging's does. Every name and number is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_field_record_ours.sql");

const AT = "2026-10-02T06:30:00.000Z";
const LATER = "2026-10-02T07:30:00.000Z";

function migrated(): DatabaseSync {
  expect(THIS).not.toBe("");
  const db = databaseBefore(THIS);
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client');
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p2', '${AT}', '+919810000002', 'Another Client');
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}');
    INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status, window_start,
      technician_id, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'wo-1', 'p1', 'service', 'scheduled', 'Scheduled', '${AT}', 't1', '${AT}', '${AT}');
    INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES ('v1', 'a1', 'done', '${AT}');
    INSERT INTO zoho_access_tokens (client, access_token, expires_at) VALUES ('crm', 'crm-token', '${LATER}');
    INSERT INTO zoho_access_tokens (client, access_token, expires_at, refreshing_until, cool_down_until)
      VALUES ('fsm', 'fsm-token', '${LATER}', '${AT}', '${LATER}');
  `);
  apply(db, THIS);
  return db;
}

/** A statement, run as expect() runs what it is to see throw. */
const running = (db: DatabaseSync, sql: string) => () => {
  db.exec(sql);
};

describe("migration 0070", () => {
  it("keeps what FSM said of a visit it already holds", () => {
    const db = migrated();
    expect(db.prepare("SELECT fsm_status, fsm_modified_at, status FROM appointments WHERE id = 'a1'").get()).toEqual({
      fsm_status: "Scheduled",
      fsm_modified_at: AT,
      status: "scheduled",
    });
    expect(db.prepare("SELECT appointment_id FROM visits").get()).toEqual({ appointment_id: "a1" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("takes a visit booked without FSM: its own ID as its FSM ID, and no FSM status or change time", () => {
    const db = migrated();
    db.exec(`INSERT INTO appointments (id, fsm_id, fsm_work_order_id, person_id, type, status, fsm_status,
      window_start, technician_id, fsm_modified_at, synced_at)
      VALUES ('a2', 'a2', NULL, 'p1', 'first_fit', 'scheduled', NULL, '${AT}', 't1', NULL, '${AT}')`);
    expect(
      db
        .prepare("SELECT fsm_id, fsm_work_order_id, fsm_status, fsm_modified_at FROM appointments WHERE id = 'a2'")
        .get(),
    ).toEqual({ fsm_id: "a2", fsm_work_order_id: null, fsm_status: null, fsm_modified_at: null });
    db.close();
  });

  it("still takes a visit as the code already deployed writes it", () => {
    const db = migrated();
    db.exec(`INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at,
      synced_at) VALUES ('a3', 'ap-3', 'p1', 'service', 'scheduled', 'Scheduled', '${AT}', '${AT}', '${AT}')`);
    expect(db.prepare("SELECT fsm_status FROM appointments WHERE id = 'a3'").get()).toEqual({
      fsm_status: "Scheduled",
    });
    // The status keeps its seven words.
    expect(
      running(db, `INSERT INTO appointments (id, fsm_id, status, synced_at) VALUES ('a4', 'a4', 'booked', '${AT}')`),
    ).toThrow(/CHECK/);
    db.close();
  });

  it("keeps each Zoho client's token and lease, and takes one for Books", () => {
    const db = migrated();
    expect(db.prepare("SELECT * FROM zoho_access_tokens ORDER BY client").all()).toEqual([
      {
        client: "crm",
        access_token: "crm-token",
        expires_at: LATER,
        refreshing_until: null,
        cool_down_until: null,
      },
      {
        client: "fsm",
        access_token: "fsm-token",
        expires_at: LATER,
        refreshing_until: AT,
        cool_down_until: LATER,
      },
    ]);
    db.exec(`INSERT INTO zoho_access_tokens (client, refreshing_until) VALUES ('books', '${AT}')`);
    expect(running(db, "INSERT INTO zoho_access_tokens (client) VALUES ('desk')")).toThrow(/CHECK/);
    expect(running(db, "INSERT INTO zoho_access_tokens (client) VALUES ('crm')")).toThrow(/UNIQUE/);
    db.close();
  });

  it("links a person to one Books customer that no one else has", () => {
    const db = migrated();
    expect(db.prepare("SELECT books_customer_id FROM people ORDER BY id").all()).toEqual([
      { books_customer_id: null },
      { books_customer_id: null },
    ]);
    db.exec("UPDATE people SET books_customer_id = 'customer-1' WHERE id = 'p1'");
    expect(running(db, "UPDATE people SET books_customer_id = 'customer-1' WHERE id = 'p2'")).toThrow(/UNIQUE/);
    db.close();
  });

  it("leaves each service's Books item to be found", () => {
    const db = migrated();
    const services = db.prepare("SELECT books_item_id FROM services").all();
    expect(services.length).toBeGreaterThan(0);
    expect(services.every((service) => service.books_item_id === null)).toBe(true);
    db.close();
  });
});
