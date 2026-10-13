// Migration 0156: a worn piece with a later one fitted for the same client is marked replaced; one that failed is not.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_pieces_replaced.sql");

describe("migration 0156", () => {
  it("marks replaced each worn piece a later fit took the place of, as that fit was recorded", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    db.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '2026-01-01T00:00:00.000Z', '+919810000001', 'Rohit')",
    ).run();
    const fit = db.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, failed_at, synced_at)
       VALUES (?1, ?1, 'p1', ?1, ?2, ?3, ?4)`,
    );
    fit.run("MM-1", "2026-01-10", null, "2026-01-10T06:00:00.000Z");
    fit.run("MM-2", "2026-04-10", "2026-05-01T06:00:00.000Z", "2026-04-10T06:00:00.000Z");
    fit.run("MM-3", "2026-05-02", null, "2026-05-02T06:00:00.000Z");

    apply(db, THIS);

    expect(db.prepare("SELECT piece_code, replaced_at FROM pieces ORDER BY piece_code").all()).toEqual([
      { piece_code: "MM-1", replaced_at: "2026-04-10T06:00:00.000Z" },
      { piece_code: "MM-2", replaced_at: null },
      { piece_code: "MM-3", replaced_at: null },
    ]);
    db.close();
  });
});
