// Migration 0009 rebuilds consents for the app's purposes (docs/decisions/0042-client-profile.md).
// Consents are the legal record: every row must survive, the table must stay
// append-only, and the purposes must stay checked. D1 is SQLite, so this
// applies the real migration files to an in-memory SQLite database.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseThrough } from "./migrations.ts";

function migratedTo(last: string): DatabaseSync {
  const db = databaseThrough(last);
  return db;
}

const insertConsent = (db: DatabaseSync, id: string, purpose: string) =>
  db
    .prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
       VALUES (?, 'p1', ?, 'v1', 1, '2026-09-20T00:00:00Z', 'h')`,
    )
    .run(id, purpose);

describe("migration 0009", () => {
  it("carries every Phase 1 consent across unchanged", () => {
    const db = migratedTo("0008_profile.sql");
    db.exec(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-20T00:00:00Z', '+919810000001', 'A', 1)",
    );
    insertConsent(db, "c-contact", "contact");
    insertConsent(db, "c-photo", "tryon_photo");
    insertConsent(db, "c-result", "result_delivery");
    const before = db.prepare("SELECT * FROM consents ORDER BY id").all();

    apply(db, "0009_consents_v2.sql");

    expect(db.prepare("SELECT * FROM consents ORDER BY id").all()).toEqual(before);
  });

  it("takes Phase 2's five purposes, and still refuses any other", () => {
    const db = migratedTo("0009_consents_v2.sql");
    db.exec(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-20T00:00:00Z', '+919810000001', 'A', 1)",
    );
    for (const purpose of [
      "photos_own_record",
      "photos_referral_cards",
      "photos_marketing",
      "whatsapp_visits",
      "whatsapp_launches",
    ]) {
      insertConsent(db, purpose, purpose);
    }
    expect(() => insertConsent(db, "c-other", "anything_else")).toThrow(/CHECK constraint failed/);
  });

  it("stays append-only, and leaves no copy behind", () => {
    const db = migratedTo("0009_consents_v2.sql");
    db.exec(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES ('p1', '2026-09-20T00:00:00Z', '+919810000001', 'A', 1)",
    );
    insertConsent(db, "c1", "photos_marketing");
    expect(() => {
      db.exec("UPDATE consents SET granted = 0");
    }).toThrow(/append-only/);
    expect(() => {
      db.exec("DELETE FROM consents");
    }).toThrow(/append-only/);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'consents%'").all();
    expect(tables).toEqual([{ name: "consents" }]);
  });
});
