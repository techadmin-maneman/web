// Migration 0157: each payment link sent keeps when it closes, fourteen days on as every link so far was made; one not
// yet sent has none.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_payment_link_closes.sql");

describe("migration 0157", () => {
  it("gives each link sent its close, fourteen days after it was sent", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    db.prepare("PRAGMA foreign_keys = OFF").run();
    const link = db.prepare(
      `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, sent_at, created_at,
         updated_at)
       VALUES (?1, ?1, 'standard', 1180000, 1000000, 18, ?2, '2026-09-21T06:00:00.000Z', '2026-09-21T06:00:00.000Z')`,
    );
    link.run("sent", "2026-09-21T06:30:00.000Z");
    link.run("unsent", null);

    apply(db, THIS);

    expect(db.prepare("SELECT id, closes_at FROM payment_links ORDER BY id").all()).toEqual([
      { id: "sent", closes_at: "2026-10-05T06:30:00.000Z" },
      { id: "unsent", closes_at: null },
    ]);
    db.close();
  });
});
