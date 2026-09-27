// Migration 0045: a client's try-on, kept (docs/decisions/0084-a-clients-try-on-is-kept.md). Applied to a
// database holding try-ons, as staging's does. Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0045_")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

function job(id: string): string {
  return `INSERT INTO tryon_jobs (id, created_at, upload_key, state, person_id, photo_consent_version,
    photo_consent_at, ip_hash, request_id)
    VALUES ('${id}', '${AT}', 'uploads/${id}', 'ready', 'client', 'photo-v1', '${AT}', 'h', 'r');`;
}

function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('client', '${AT}', '+919810000001', 'Rohit');
    ${job("j1")} ${job("j2")}`);
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  return db;
}

describe("migration 0045", () => {
  it("leaves every try-on as it was: no copy, not kept, no look moved", () => {
    const db = migrated();
    expect(db.prepare("SELECT id, copy_key, kept_at, kept_look_key FROM tryon_jobs ORDER BY id").all()).toEqual([
      { id: "j1", copy_key: null, kept_at: null, kept_look_key: null },
      { id: "j2", copy_key: null, kept_at: null, kept_look_key: null },
    ]);
  });

  it("lets a client keep one try-on and no more", () => {
    const db = migrated();
    db.prepare("UPDATE tryon_jobs SET kept_at = ?1 WHERE id = 'j1'").run(AT);
    expect(() => db.prepare("UPDATE tryon_jobs SET kept_at = ?1 WHERE id = 'j2'").run(AT)).toThrow(/UNIQUE/);
  });
});
