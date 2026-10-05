// Migration 0089: the generic "First fit" migration 0050 seeded is retired everywhere, and nothing else changes.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_retire_generic_first_fit.sql");

function upTo(): DatabaseSync {
  expect(THIS).not.toBe("");
  const db = databaseBefore(THIS);
  return db;
}

function applyThis(db: DatabaseSync): void {
  apply(db, THIS);
}

const retiredDates = (db: DatabaseSync) =>
  db.prepare("SELECT kind, tier, retired_date FROM services ORDER BY kind, tier").all();

describe("migration 0089", () => {
  it("retires the generic first fit from 2 October 2026 and leaves every other service offered", () => {
    const db = upTo();
    db.exec(`INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
      VALUES ('first_fit', 'essential', 'Mane Man Essential', 180, 1, 'ops@example.com', '2026-10-01T06:30:00.000Z')`);
    applyThis(db);
    expect(retiredDates(db)).toEqual([
      { kind: "consultation", tier: "standard", retired_date: null },
      { kind: "first_fit", tier: "essential", retired_date: null },
      { kind: "first_fit", tier: "standard", retired_date: "2026-10-02" },
      { kind: "replacement", tier: "standard", retired_date: null },
      { kind: "service", tier: "standard", retired_date: null },
    ]);
    expect(db.prepare("SELECT updated_by FROM services WHERE kind = 'first_fit' AND tier = 'standard'").get()).toEqual({
      updated_by: "migrations/0089_retire_generic_first_fit.sql",
    });
    db.close();
  });

  it("keeps an earlier retirement ops gave it, and brings a later one forward", () => {
    const earlier = upTo();
    earlier.exec(
      "UPDATE services SET retired_date = '2026-09-30', updated_by = 'ops@example.com' WHERE tier = 'standard' AND kind = 'first_fit'",
    );
    applyThis(earlier);
    expect(
      earlier
        .prepare("SELECT retired_date, updated_by FROM services WHERE kind = 'first_fit' AND tier = 'standard'")
        .get(),
    ).toEqual({ retired_date: "2026-09-30", updated_by: "ops@example.com" });
    earlier.close();

    const later = upTo();
    later.exec("UPDATE services SET retired_date = '2026-12-01' WHERE tier = 'standard' AND kind = 'first_fit'");
    applyThis(later);
    expect(
      later.prepare("SELECT retired_date FROM services WHERE kind = 'first_fit' AND tier = 'standard'").get(),
    ).toEqual({ retired_date: "2026-10-02" });
    later.close();
  });

  it("keeps the generic first fit's prices, so what was sold under it stays priced", () => {
    const db = upTo();
    const before = db.prepare("SELECT * FROM price_book WHERE item = 'first_fit' AND tier = 'standard'").all();
    applyThis(db);
    expect(db.prepare("SELECT * FROM price_book WHERE item = 'first_fit' AND tier = 'standard'").all()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
    db.close();
  });
});
