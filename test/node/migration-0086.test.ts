// Migration 0086: when the chat was last told of each alert, and the open alerts whose subject is gone closed, applied
// to a database that already holds alerts as staging's does. Every ID is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.endsWith("_alerts_retold.sql")) ?? "";

const AT = "2026-10-02T06:30:00.000Z";
const TOLD = "2026-10-02T06:35:00.000Z";

function alert(key: string): string {
  return `INSERT INTO alerts (id, key, message, count, first_seen_at, last_seen_at)
    VALUES ('${key}', '${key}', 'A message.', 1, '${AT}', '${AT}');`;
}

function migrated(): DatabaseSync {
  expect(THIS).not.toBe("");
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(`
    INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, '${AT}');
    INSERT INTO appointments (id, fsm_id, type, status, window_start, technician_id, synced_at, deleted_at)
      VALUES ('gone', 'ap-1', 'service', 'completed', '${AT}', 't1', '${AT}', '${AT}');
    INSERT INTO appointments (id, fsm_id, type, status, window_start, technician_id, synced_at)
      VALUES ('kept', 'ap-2', 'service', 'completed', '${AT}', 't1', '${AT}');
    INSERT INTO job_events (id, appointment_id, event_id, technician_id, kind, body, occurred_at, received_at,
      fsm_write_state, superseded, updated_at)
    VALUES
      ('waiting', 'kept', 'e1', 't1', 'check_in', '{}', '${AT}', '${AT}', 'pending', 0, '${AT}'),
      ('set-aside', 'kept', 'e2', 't1', 'start', '{}', '${AT}', '${AT}', 'pending', 1, '${AT}'),
      ('written', 'kept', 'e3', 't1', 'checklist', '{}', '${AT}', '${AT}', 'written', 0, '${AT}');
    ${alert("google_refused:2026-09-27")}
    ${alert("turnstile_unavailable:2026-09-30")}
    ${alert("invoice_draft:gone")}
    ${alert("invoice_failed:gone")}
    ${alert("invoice_draft:kept")}
    ${alert("job_event_pending:waiting")}
    ${alert("job_event_pending:set-aside")}
    ${alert("job_event_pending:written")}
    ${alert("job_event_pending:never-landed")}
    ${alert("whatsapp_bridge")}
    UPDATE alerts SET told_at = '${TOLD}';
  `);
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

const openKeys = (db: DatabaseSync) =>
  db
    .prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key")
    .all()
    .map((row) => row.key);

describe("migration 0086", () => {
  it("counts an open alert as last told when it was first told", () => {
    const db = migrated();
    expect(db.prepare("SELECT last_told_at FROM alerts WHERE key = 'whatsapp_bridge'").get()).toEqual({
      last_told_at: TOLD,
    });
    db.close();
  });

  it("closes the dated alerts, the invoice alerts of deleted visits and the steps no longer waiting for FSM", () => {
    const db = migrated();
    expect(openKeys(db)).toEqual(["invoice_draft:kept", "job_event_pending:waiting", "whatsapp_bridge"]);
    db.close();
  });

  it("closes them at an instant written as the code writes one", () => {
    const db = migrated();
    const closed = db.prepare("SELECT resolved_at FROM alerts WHERE key = 'invoice_draft:gone'").get();
    expect(closed?.resolved_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    db.close();
  });
});
