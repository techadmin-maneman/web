// Migration 0057: where each consent was given, and a check-in an erasure can take the coordinates off
// (docs/decisions/0094-where-a-consent-was-given.md). Applied to a database that already holds consents and
// check-ins, as staging's does, and then written to as the Worker deployed before it writes. Every name and number
// is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0057_")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

/** One consent of the client's, on the notice named, as every writer before this migration wrote it. */
function consent(db: DatabaseSync, noticeVersion: string, purpose: string, granted = 1): void {
  db.prepare(
    `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash)
     VALUES (?, 'p1', ?, ?, ?, ?, 'a-hash')`,
  ).run(crypto.randomUUID(), purpose, noticeVersion, granted, AT);
}

/** The database before this migration: a consent on every notice there is, and a check-in with a case on it. */
function beforeThisMigration(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) {
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
  }
  db.exec(`
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client');
    INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
      VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}');
    INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, fsm_modified_at, synced_at)
      VALUES ('a1', 'ap-1', 'p1', 'service', 'dispatched', 'Dispatched', '${AT}', '${AT}', '${AT}');
    INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, lat, lng, accuracy_m, distance_m, radius_m,
      passed, created_at) VALUES ('c1', 'a1', 't1', NULL, '${AT}', 28.3988, 77.07, 12.5, NULL, 200, 1, '${AT}');
    INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, created_at)
      VALUES ('n1', 'c1', 'a1', '${AT}', '${AT}', '${AT}');
  `);
  consent(db, "booking-v1", "contact");
  consent(db, "photo-v1", "tryon_photo");
  consent(db, "photo-v2", "tryon_photo");
  consent(db, "gate-v1", "result_delivery");
  consent(db, "gate-v2", "result_delivery");
  consent(db, "photos-own-record-booking-v1", "photos_own_record");
  consent(db, "photos-referral-cards-booking-v1", "photos_referral_cards");
  consent(db, "photos-own-record-booking-alone-v1", "photos_own_record");
  consent(db, "photos-referral-cards-booking-alone-v1", "photos_referral_cards");
  consent(db, "photos-own-record-v1", "photos_own_record");
  consent(db, "photos-marketing-v1", "photos_marketing", 0);
  consent(db, "withdrawal", "whatsapp_visits", 0);
  consent(db, "referral-consultation-v1", "whatsapp_visits");
  consent(db, "waitlist-v1", "contact");
  consent(db, "whatsapp-launches-v1", "whatsapp_launches");
  consent(db, "whatsapp-visits-v1", "whatsapp_visits");
  consent(db, "photos-referral-cards-v1", "photos_referral_cards");
  consent(db, "photos-referral-cards-v2", "photos_referral_cards");
  return db;
}

function migrated(): DatabaseSync {
  const db = beforeThisMigration();
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

const sourceOf = (db: DatabaseSync, noticeVersion: string) =>
  db.prepare("SELECT source FROM consents WHERE notice_version = ?").get(noticeVersion)?.source;

describe("migration 0057", () => {
  it("gives a consent the place its notice was shown in, where it was shown in one place only", () => {
    const db = migrated();
    expect(sourceOf(db, "booking-v1")).toBe("site_booking");
    for (const notice of ["photo-v1", "photo-v2", "gate-v1", "gate-v2"]) expect(sourceOf(db, notice)).toBe("try_on");
    for (const notice of [
      "photos-own-record-booking-v1",
      "photos-referral-cards-booking-v1",
      "photos-own-record-booking-alone-v1",
      "photos-referral-cards-booking-alone-v1",
    ]) {
      expect(sourceOf(db, notice)).toBe("app_booking");
    }
    expect(sourceOf(db, "photos-own-record-v1")).toBe("app_profile");
    expect(sourceOf(db, "photos-marketing-v1")).toBe("app_profile");
    expect(sourceOf(db, "withdrawal")).toBe("erasure");
    db.close();
  });

  it("leaves it unknown where the notice was shown in more than one place", () => {
    const db = migrated();
    // The consultation's line and the waitlist's are on /book and on an invite's page; the launch alert on the
    // waitlist and in the profile; the visits' WhatsApp in the profile and the booking sheet; cards in the profile
    // and the share sheet.
    for (const notice of [
      "referral-consultation-v1",
      "waitlist-v1",
      "whatsapp-launches-v1",
      "whatsapp-visits-v1",
      "photos-referral-cards-v1",
      "photos-referral-cards-v2",
    ]) {
      expect(sourceOf(db, notice)).toBeNull();
    }
    db.close();
  });

  it("keeps the consents append-only, and takes one the deployed code writes, with no source", () => {
    const db = migrated();
    expect(() => {
      db.exec("UPDATE consents SET source = 'app_profile'");
    }).toThrow(/append-only/);
    expect(() => {
      db.exec("DELETE FROM consents");
    }).toThrow(/append-only/);
    consent(db, "photos-marketing-v1", "photos_marketing");
    expect(db.prepare("SELECT COUNT(*) AS rows FROM consents WHERE source IS NULL").get()).toEqual({ rows: 7 });
    db.close();
  });

  it("keeps a check-in's coordinates, and lets them be blanked while the case on it still points at it", () => {
    const db = migrated();
    expect(db.prepare("SELECT lat, lng, accuracy_m, radius_m FROM checkins").get()).toEqual({
      lat: 28.3988,
      lng: 77.07,
      accuracy_m: 12.5,
      radius_m: 200,
    });
    db.exec("UPDATE checkins SET lat = NULL, lng = NULL, accuracy_m = NULL");
    expect(db.prepare("SELECT lat, lng FROM checkins").get()).toEqual({ lat: null, lng: null });
    expect(db.prepare("SELECT checkin_id FROM no_show_cases").get()).toEqual({ checkin_id: "c1" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("takes a check-in as the deployed code writes it", () => {
    const db = migrated();
    db.exec(`INSERT INTO checkins (id, appointment_id, technician_id, address_id, at, claimed_at, lat, lng, accuracy_m,
      distance_m, radius_m, passed, created_at)
      VALUES ('c2', 'a1', 't1', NULL, '${AT}', '${AT}', 28.4, 77.1, NULL, NULL, 200, 1, '${AT}')`);
    expect(db.prepare("SELECT lat, lng FROM checkins WHERE id = 'c2'").get()).toEqual({ lat: 28.4, lng: 77.1 });
    db.close();
  });
});
