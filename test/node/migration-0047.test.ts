// Migration 0047: the services clients book (docs/decisions/0085-services-ops-can-edit.md). Applied to a database
// holding a hold and a visit, as staging's does, and held to what the Worker already deployed writes. Every name
// and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { VISIT_BLOCKS } from "../../src/config/scheduling.ts";
import { FSM_SERVICE_NAMES, VISIT_TYPES } from "../../src/config/visit-types.ts";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0047_")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

/** A hold and a visit, as the code before services made them: neither names a tier. */
const HOLD = `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
  amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at)
  VALUES ('hold-2', 'client', 'service', '2026-09-23', 'afternoon', 't1', 2, 200000, 200000, 0, 'held', '${AT}',
    '${AT}', '${AT}');`;

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('client', '${AT}', '+919810000001', 'Rohit');
    INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'sr-1', 'Imran', 'I', 1, '${AT}');
    INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount, amount_ex_gst,
      gst_percent, state, expires_at, created_at, updated_at)
      VALUES ('hold-1', 'client', 'first_fit', '2026-09-22', 'morning', 't1', 0, 3000000, 3000000, 0, 'held', '${AT}',
        '${AT}', '${AT}');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'client', 'service', 'scheduled', 'Scheduled', '${AT}', '${AT}', '${AT}');`);
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  return db;
}

describe("migration 0047", () => {
  it("starts each kind with the standard service it always had, named as FSM names it, as long as the owner ruled", () => {
    const db = migrated();
    const services = db.prepare("SELECT kind, tier, name, minutes, retired_date, fsm_item_id FROM services").all();
    expect(services).toEqual(
      VISIT_TYPES.map((kind) => ({
        kind,
        tier: "standard",
        name: FSM_SERVICE_NAMES[kind],
        minutes: VISIT_BLOCKS[kind].minutes,
        retired_date: null,
        fsm_item_id: null,
      })),
    );
    const stamped = db.prepare("SELECT updated_by, updated_at FROM services LIMIT 1").get() as {
      updated_by: string;
      updated_at: string;
    };
    expect(stamped.updated_by).toBe("migrations/0047_services.sql");
    expect(stamped.updated_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  it("reads every hold made before, and each the Worker already deployed makes, as the standard tier's", () => {
    const db = migrated();
    db.exec(HOLD);
    expect(db.prepare("SELECT id, tier, minutes FROM slot_holds ORDER BY id").all()).toEqual([
      { id: "hold-1", tier: "standard", minutes: null },
      { id: "hold-2", tier: "standard", minutes: null },
    ]);
    expect(db.prepare("SELECT tier FROM appointments").get()).toEqual({ tier: null });
  });

  it("holds each kind to one service a code, one name a service whatever its case, and a length the day can hold", () => {
    const db = migrated();
    const add = (kind: string, tier: string, name: string, minutes = 90) =>
      db
        .prepare(
          `INSERT INTO services (kind, tier, name, minutes, updated_by, updated_at) VALUES (?, ?, ?, ?, 'ops@localhost', ?)`,
        )
        .run(kind, tier, name, minutes, AT);
    expect(() => add("service", "premium", "Premium service")).not.toThrow();
    expect(() => add("first_fit", "premium", "Premium first fit")).not.toThrow();
    expect(() => add("service", "premium", "Another")).toThrow(/UNIQUE/);
    expect(() => add("replacement", "lace", "premium SERVICE")).toThrow(/UNIQUE/);
    expect(() => add("service", "long", "Too long", 481)).toThrow(/CHECK/);
    expect(() => add("service", "short", "Too short", 29)).toThrow(/CHECK/);
    expect(() => add("wig", "standard", "A wig")).toThrow(/CHECK/);
    expect(() => add("service", "Premium", "Capital code")).toThrow(/CHECK/);
    expect(() => add("service", "2x", "Digit first")).toThrow(/CHECK/);
    expect(() => add("service", "lace-front", "Dashed")).toThrow(/CHECK/);
  });
});
