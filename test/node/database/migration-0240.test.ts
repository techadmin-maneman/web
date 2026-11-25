// Migration 0240: Customer Care's hours as ops set them become their times to the minute, the opening, closing and
// answered-by hours times sixty and the first-reply minutes as they were, kept by who set them; where ops never set
// them, the committed default stands (docs/decisions/0322-care-times.md). Every figure here is made up.

import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_care_times.sql");

describe("migration 0240", () => {
  it("copies the hours ops set into care_times, in minutes past midnight", () => {
    expect(THIS).not.toBe("");
    const db = databaseBefore(THIS);
    db.prepare(
      `INSERT INTO ops_settings (name, value, set_by, set_at)
       VALUES ('care_hours', '{"opens":10,"closes":20,"first_reply":30,"answered_by":11}', 'care@localhost',
         '2026-11-20T06:00:00.000Z')`,
    ).run();
    apply(db, THIS);
    const row = db.prepare("SELECT value, set_by, set_at FROM ops_settings WHERE name = 'care_times'").get() as
      { value: string; set_by: string; set_at: string } | undefined;
    expect(row === undefined ? null : { ...row, value: JSON.parse(row.value) as unknown }).toEqual({
      value: { opens: 600, closes: 1200, first_reply: 30, answered_by: 660 },
      set_by: "care@localhost",
      set_at: "2026-11-20T06:00:00.000Z",
    });
    db.close();
  });

  it("writes nothing where ops never set the hours, so the default stands", () => {
    const db = databaseBefore(THIS);
    apply(db, THIS);
    expect(db.prepare("SELECT name FROM ops_settings WHERE name = 'care_times'").all()).toEqual([]);
    db.close();
  });
});
