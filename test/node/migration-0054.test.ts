// Migration 0054: the storage meter and a photograph's small copy
// (docs/decisions/0093-the-storage-meter.md). Applied to a database that
// already holds photographs, a referral card and a client's kept try-on, as
// staging's does. Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0054_")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

function migrated(held: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('client', '${AT}', '+919810000001', 'Rohit');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'client', 'service', 'completed', 'Completed', '${AT}', '${AT}');
    INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('s1', 'a1', 'after', '${AT}');`);
  db.exec(held);
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  return db;
}

const photo = (angle: string, bytes: number) =>
  `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
   VALUES ('p-${angle}', 's1', '${angle}', 'visits/a1/after-${angle}.jpg', 'image/jpeg', ${String(bytes)}, '${AT}', '${AT}');`;

const meter = (db: DatabaseSync) => db.prepare("SELECT bytes, told_percent FROM storage_meter").all();

describe("migration 0054", () => {
  it("starts the meter at what the photographs' rows say they hold", () => {
    const db = migrated(photo("front", 240_000) + photo("hair", 260_000));
    expect(meter(db)).toEqual([{ bytes: 500_000, told_percent: 0 }]);
  });

  it("counts a card, a kept copy and a kept look, whose sizes no row records, at their upload limits", () => {
    const db = migrated(`
      INSERT INTO referral_codes (code, person_id, card_state, card_version, card_key, created_at, updated_at)
        VALUES ('ROHIT7', 'client', 'personal', 2, 'cards/ROHIT7/v2.jpg', '${AT}', '${AT}');
      INSERT INTO tryon_jobs (id, created_at, upload_key, state, person_id, photo_consent_version, photo_consent_at,
        ip_hash, request_id, copy_key, kept_at, kept_look_key)
        VALUES ('j1', '${AT}', 'uploads/j1', 'expired', 'client', 'photo-v2', '${AT}', 'h', 'r',
          'tryons/j1/before.jpg', '${AT}', 'tryons/j1/look.png');`);
    // A card at 300 KB, a copy at 250 KB and a look at 5 MB (MAX_CARD_BYTES, MAX_COPY_BYTES, MAX_RESULT_BYTES).
    expect(meter(db)).toEqual([{ bytes: 300 * 1024 + 250 * 1024 + 5 * 1024 * 1024, told_percent: 0 }]);
  });

  it("starts at nought on an empty database, and holds one row", () => {
    const db = migrated("");
    expect(meter(db)).toEqual([{ bytes: 0, told_percent: 0 }]);
    expect(() => db.exec("INSERT INTO storage_meter (id, bytes) VALUES (2, 0)")).toThrow(/CHECK/);
  });

  it("gives every photograph an empty small copy, which the ones taken from now on fill", () => {
    const db = migrated(photo("front", 240_000));
    expect(db.prepare("SELECT thumbnail_key FROM photos").all()).toEqual([{ thumbnail_key: null }]);
  });
});
