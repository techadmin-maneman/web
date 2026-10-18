// Migration 0190: each first fit's product becomes a package, with a service visit and a replacement of its own and
// each hair system a price of its own, split so every total stays as it was; and each client fitted is on the package
// of their last first fit. Every name here is made up.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_packages.sql");

/** India's date when the test runs, which the migration's prices start from. */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

function staging() {
  const db = databaseBefore(THIS);
  const at = "2026-09-01T00:00:00.000Z";
  db.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops', ?1)`,
  ).run(at);
  db.prepare(
    `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
     VALUES ('first_fit', 'essential', 3200000, 0, '2026-01-01'), ('service', 'standard', 220000, 0, '2026-10-01')`,
  ).run();
  db.prepare(
    `INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
     VALUES ('hs_essential_8x10', 'Mane Man Essential 8 x 10', 'piece', 800000, ?1, ?1)`,
  ).run(at);
  db.prepare(
    `INSERT INTO hair_systems (code, product, base_width_in, base_length_in, colour, grey_percent, density_percent)
     VALUES ('hs_essential_8x10', 'essential', 8, 10, '1B', 0, 100)`,
  ).run();
  db.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', ?1, '+919810000001', 'Rohit'), ('p2', ?1, '+919810000002', 'Kabir')",
  ).run(at);
  db.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, synced_at)
     VALUES ('a1', 'a1', 'p1', 'first_fit', 'essential', 'completed', ?1, ?1, ?1)`,
  ).run(at);
  return db;
}

describe("migration 0190", () => {
  it("makes each first fit's product a package, with its service visit and replacement named from it", () => {
    expect(THIS).not.toBe("");
    const db = staging();
    apply(db, THIS);

    expect(
      db.prepare("SELECT code, service_every_days, replace_after_months FROM packages ORDER BY code").all(),
    ).toEqual([
      { code: "essential", service_every_days: 30, replace_after_months: 6 },
      { code: "standard", service_every_days: 30, replace_after_months: 6 },
    ]);
    expect(db.prepare("SELECT kind, name, minutes FROM services WHERE tier = 'essential' ORDER BY kind").all()).toEqual(
      [
        { kind: "first_fit", name: "Mane Man Essential", minutes: 180 },
        { kind: "replacement", name: "Mane Man Essential replacement", minutes: 135 },
        { kind: "service", name: "Mane Man Essential service visit", minutes: 90 },
      ],
    );
    db.close();
  });

  it("splits each total into its parts from today, so a first fit and a replacement cost what they did", () => {
    const db = staging();
    apply(db, THIS);

    const priced = db
      .prepare("SELECT item, tier, amount_ex_gst, valid_from FROM price_book WHERE valid_from = ?1 ORDER BY item")
      .all(today());
    expect(priced).toEqual([
      { item: "hair_system", tier: "hs_essential_8x10", amount_ex_gst: 2980000, valid_from: today() },
      { item: "replacement", tier: "essential", amount_ex_gst: 1280000, valid_from: today() },
      { item: "service", tier: "essential", amount_ex_gst: 220000, valid_from: today() },
    ]);
    // The standard package's prices stay as they were.
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM price_book WHERE tier = 'standard' AND valid_from = ?1").get(today()),
    ).toEqual({
      n: 0,
    });
    db.close();
  });

  it("puts each client fitted on the package of their last first fit, and nobody else on one", () => {
    const db = staging();
    apply(db, THIS);

    expect(db.prepare("SELECT id, package FROM people ORDER BY id").all()).toEqual([
      { id: "p1", package: "essential" },
      { id: "p2", package: null },
    ]);
    db.close();
  });
});
