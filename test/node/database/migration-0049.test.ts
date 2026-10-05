// Migration 0049: consumables, their stock and the job sheet ops set
// (docs/decisions/0087-consumables-and-stock.md). Applied to a database that
// already holds a job's consumables by name, as staging's may. Every name and
// number is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("0049_");

const AT = "2026-09-21T06:30:00.000Z";

function migrated(): DatabaseSync {
  const db = databaseBefore(THIS);
  db.exec(`
    INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'r1', 'Imran', 'IQ', 1, '${AT}');
    INSERT INTO appointments (id, fsm_id, type, status, fsm_status, technician_id, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'service', 'in_progress', 'In Progress', 't1', '${AT}', '${AT}');
    INSERT INTO job_events (id, appointment_id, event_id, technician_id, device_id, kind, body, occurred_at,
      received_at, updated_at)
      VALUES ('e1', 'a1', 'event-1', 't1', NULL, 'consumables', '{"items":[{"name":"Adhesive","quantity":2}]}',
        '${AT}', '${AT}', '${AT}');
    INSERT INTO consumables_used (id, appointment_id, job_event_id, name, quantity, created_at)
      VALUES ('u1', 'a1', 'e1', 'Adhesive', 2, '${AT}');`);
  apply(db, THIS);
  db.exec(
    `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
     VALUES ('tape_strips', 'Tape strips', 'strip', 1200, '${AT}', '${AT}')`,
  );
  return db;
}

/** A row of the ledger, with only what differs from a delivery into the store. */
function movement(db: DatabaseSync, fields: Record<string, string | number | null>): void {
  const row: Record<string, string | number | null> = {
    id: crypto.randomUUID(),
    consumable_code: "tape_strips",
    location: "central",
    technician_id: null,
    quantity: 10,
    reason: "received",
    actor_kind: "staff",
    actor: "ops@maneman.in",
    created_at: AT,
    ...fields,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO stock_movements (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...Object.values(row),
  );
}

describe("migration 0049", () => {
  it("keeps a job's consumables recorded by name, their code, expectation and cost left empty", () => {
    const db = migrated();
    expect(
      db.prepare("SELECT name, quantity, consumable_code, expected_quantity, unit_cost FROM consumables_used").all(),
    ).toEqual([{ name: "Adhesive", quantity: 2, consumable_code: null, expected_quantity: null, unit_cost: null }]);
  });

  it("never calls two consumables the same, whatever the case", () => {
    const db = migrated();
    expect(() => {
      db.exec(
        `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
         VALUES ('tape_2', 'TAPE STRIPS', 'strip', 1, '${AT}', '${AT}')`,
      );
    }).toThrow(/UNIQUE/);
  });

  it("keeps a kit a technician's and the store no one's, and a movement never nought but a count's", () => {
    const db = migrated();
    expect(() => {
      movement(db, { location: "kit" });
    }).toThrow(/CHECK/);
    expect(() => {
      movement(db, { technician_id: "t1" });
    }).toThrow(/CHECK/);
    expect(() => {
      movement(db, { quantity: 0 });
    }).toThrow(/CHECK/);
    movement(db, { quantity: 0, reason: "counted" });
    expect(() => {
      movement(db, { reason: "transferred", quantity: -5 });
    }).toThrow(/CHECK/);
    movement(db, { reason: "transferred", quantity: -5, transfer_id: "x1" });
  });

  it("takes a job's use only from a kit, for a job and the event that recorded it, once for each", () => {
    const db = migrated();
    const used = { location: "kit", technician_id: "t1", reason: "used", quantity: -4, actor_kind: "technician" };
    expect(() => {
      movement(db, used);
    }).toThrow(/CHECK/);
    expect(() => {
      movement(db, { ...used, job_event_id: "e1" });
    }).toThrow(/CHECK/);
    movement(db, { ...used, job_event_id: "e1", appointment_id: "a1" });
    expect(() => {
      movement(db, { ...used, job_event_id: "e1", appointment_id: "a1" });
    }).toThrow(/UNIQUE/);
  });

  it("expects a whole number of a consumable of a service, for one of the four kinds of visit", () => {
    const db = migrated();
    const usage = (type: string, quantity: number) => {
      db.exec(
        `INSERT INTO consumable_usage (visit_type, consumable_code, quantity, set_by, set_at)
         VALUES ('${type}', 'tape_strips', ${String(quantity)}, 'ops@maneman.in', '${AT}')`,
      );
    };
    usage("service", 4);
    expect(db.prepare("SELECT tier FROM consumable_usage").get()).toEqual({ tier: "standard" });
    expect(() => {
      usage("haircut", 4);
    }).toThrow(/CHECK/);
    expect(() => {
      usage("first_fit", 0);
    }).toThrow(/CHECK/);
  });

  it("holds each kind's checklist items once by code, and the partial reasons once each", () => {
    const db = migrated();
    const item = `INSERT INTO checklist_items (visit_type, code, label, position, set_by, set_at)
      VALUES ('service', 'piece_removed', 'Piece removed', 0, 'ops@maneman.in', '${AT}')`;
    db.exec(item);
    expect(() => {
      db.exec(item);
    }).toThrow(/UNIQUE/);
    db.exec(item.replace("'service'", "'replacement'"));
    const reason = `INSERT INTO partial_reasons (code, label, position, set_by, set_at)
      VALUES ('power_cut', 'Power cut', 0, 'ops@maneman.in', '${AT}')`;
    db.exec(reason);
    expect(() => {
      db.exec(reason);
    }).toThrow(/UNIQUE/);
  });
});
