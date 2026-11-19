// Migration 0226: the five checks on a hair system that arrives become rows, each on or off as Settings › Purchasing
// had it, and a claim already naming checks takes their names, in its order
// (docs/decisions/0283-changed-and-deleted-while-unused.md). Every figure here is made up.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_qc_points.sql");

/** A claim on a supplier naming `points`, its order and receipt left out: the migration reads none of them. */
function aClaim(db: ReturnType<typeof databaseBefore>, id: string, points: string | null) {
  db.prepare(
    `INSERT INTO supplier_claims (id, number, supplier_id, consumable_code, quantity, reason, receipt_line_id,
       unit_price, currency, state, drafted_by, drafted_at, failed_points)
     VALUES (?1, ?2, 's1', 'hs_essential', 1, 'qc_failed', ?1, 12000, 'USD', 'drafted', 'ops@localhost',
       '2026-11-18T06:00:00.000Z', ?3)`,
  ).run(id, id === "k1" ? 101 : 102, points);
}

describe("migration 0226", () => {
  it("makes the five checks rows, switching off those Settings had off", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    db.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('receipt_checks', '{"label":"skipped","density":"checked"}', 'ops@localhost', '2026-11-18T06:00:00.000Z')`,
    ).run();
    apply(db, THIS);
    expect(db.prepare("SELECT id, name, checked FROM qc_points ORDER BY sort").all()).toEqual([
      { id: "base_size", name: "Base size", checked: 1 },
      { id: "colour", name: "Colour against the ring", checked: 1 },
      { id: "density", name: "Density", checked: 1 },
      { id: "lace_knots", name: "Lace and knots", checked: 1 },
      { id: "label", name: "Label", checked: 0 },
    ]);
    db.close();
  });

  it("gives a claim naming checks their names, in its order, and leaves the rest without", () => {
    const db = databaseBefore(THIS);
    db.exec("PRAGMA foreign_keys = OFF");
    aClaim(db, "k1", '["lace_knots","colour"]');
    aClaim(db, "k2", null);
    apply(db, THIS);
    expect(db.prepare("SELECT id, failed_point_names FROM supplier_claims ORDER BY id").all()).toEqual([
      { id: "k1", failed_point_names: '["Lace and knots","Colour against the ring"]' },
      { id: "k2", failed_point_names: null },
    ]);
    db.close();
  });
});
