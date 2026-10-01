// Migration 0063: a client's hair profile, and the consent its history needs
// (docs/decisions/0106-a-clients-hair-profile.md). Applied to a database that already holds consents, as staging's
// does, and then written to as the Worker deployed before it writes. Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.startsWith("0063_")) ?? "";

const AT = "2026-10-01T06:30:00.000Z";

interface ConsentRow {
  rowid: number;
  id: string;
  person_id: string;
  purpose: string;
  notice_version: string;
  granted: number;
  created_at: string;
  ip_hash: string | null;
  source: string | null;
}

/**
 * The database before this migration: a client, a visit, a technician, and consents of one moment, which the code
 * tells apart by their rowid, at rowids a copy that numbered them afresh would not keep.
 */
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
      VALUES ('a1', 'ap-1', 'p1', 'consultation', 'in_progress', 'In Progress', '${AT}', '${AT}', '${AT}');
    INSERT INTO consents (rowid, id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
      VALUES (7, 'c-z', 'p1', 'whatsapp_visits', 'whatsapp-visits-v1', 1, '${AT}', 'a-hash', 'app_profile'),
             (3, 'c-a', 'p1', 'whatsapp_visits', 'whatsapp-visits-v1', 0, '${AT}', NULL, NULL),
             (12, 'c-m', 'p1', 'contact', 'booking-v1', 1, '${AT}', 'b-hash', 'site_booking');
  `);
  return db;
}

function migrated(): DatabaseSync {
  const db = beforeThisMigration();
  db.exec("BEGIN");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  db.exec("COMMIT");
  return db;
}

const consents = (db: DatabaseSync) =>
  db.prepare("SELECT rowid, * FROM consents ORDER BY rowid").all() as unknown as ConsentRow[];

/** A statement, run as expect() runs what it is to see throw. */
const running = (db: DatabaseSync, sql: string) => () => {
  db.exec(sql);
};

/** A version of the profile as the technician's phone records it, at visit a1 under its event ID. */
function version(db: DatabaseSync, id: string, eventId: string | null = "event-1"): void {
  db.prepare(
    `INSERT INTO hair_profiles (id, person_id, appointment_id, event_id, technician_id, created_at, norwood_stage,
       head_circumference_cm, colour, grey_percent, density_percent, product, attachment, remedies, transplant_year,
       skin_and_allergies)
     VALUES (?, 'p1', 'a1', ?, 't1', ?, 'IV', 57.5, '1B', 20, 120, 'standard', 'tape', '["minoxidil"]', NULL,
       'Dry at the crown')`,
  ).run(id, eventId, AT);
}

describe("migration 0063", () => {
  it("keeps every consent as it was, its order among those of one moment included", () => {
    const before = consents(beforeThisMigration());
    expect(consents(migrated())).toEqual(before);
  });

  it("takes the health history's consent, and still refuses a purpose it does not know", () => {
    const db = migrated();
    db.exec(`INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, source)
             VALUES ('c-h', 'p1', 'health_history', 'health-history-v1', 1, '${AT}', 'technician')`);
    const unknownPurpose = `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
                            VALUES ('c-x', 'p1', 'anything', 'v1', 1, '${AT}')`;
    expect(running(db, unknownPurpose)).toThrow(/CHECK/);
  });

  it("leaves the consent record append-only, and found by its person", () => {
    const db = migrated();
    expect(running(db, "UPDATE consents SET granted = 1 WHERE id = 'c-a'")).toThrow(/append-only/);
    expect(running(db, "DELETE FROM consents WHERE id = 'c-a'")).toThrow(/append-only/);
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM consents WHERE person_id = 'p1'").all();
    expect(JSON.stringify(plan)).toContain("consents_by_person");
  });

  it("takes the deployed Worker's consent writes as they are", () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at, ip_hash, source)
       SELECT ?, 'p1', 'photos_marketing', 'photos-marketing-v1', 1, ?, 'c-hash', 'app_profile'
       WHERE NOT EXISTS (SELECT 1 FROM consents WHERE person_id = 'p1' AND purpose = 'photos_marketing')`,
    ).run("c-n", AT);
    expect(consents(db).map((row) => row.id)).toContain("c-n");
  });

  it("keeps a version of the profile once for each of the phone's events at a visit", () => {
    const db = migrated();
    version(db, "v1");
    expect(() => {
      version(db, "v2");
    }).toThrow(/UNIQUE/);
    version(db, "v3", "event-2");
    // Ops' corrections name no visit and no event, and as many may be kept as are made.
    for (const id of ["o1", "o2"]) {
      db.prepare(
        "INSERT INTO hair_profiles (id, person_id, staff, created_at, colour) VALUES (?, 'p1', 'ops@maneman.test', ?, '2')",
      ).run(id, AT);
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM hair_profiles").get()).toEqual({ n: 4 });
  });

  it("names who recorded each version: a technician or a member of staff, never both or neither", () => {
    const db = migrated();
    const recordedBy = (technician: string | null, staff: string | null) =>
      db
        .prepare(
          "INSERT INTO hair_profiles (id, person_id, technician_id, staff, created_at) VALUES (?, 'p1', ?, ?, ?)",
        )
        .run(crypto.randomUUID(), technician, staff, AT);
    expect(() => recordedBy(null, null)).toThrow(/CHECK/);
    expect(() => recordedBy("t1", "ops@maneman.test")).toThrow(/CHECK/);
  });

  it("never changes a version, nor deletes one: it may only be blanked, as an erasure does", () => {
    const db = migrated();
    version(db, "v1");
    expect(running(db, "UPDATE hair_profiles SET colour = '2' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "UPDATE hair_profiles SET person_id = 'p2' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "UPDATE hair_profiles SET created_at = 'now' WHERE id = 'v1'")).toThrow(/only blanked/);
    expect(running(db, "DELETE FROM hair_profiles WHERE id = 'v1'")).toThrow(/kept/);

    db.exec(`UPDATE hair_profiles SET remedies = NULL, transplant_year = NULL, skin_and_allergies = NULL
             WHERE id = 'v1'`);
    db.exec(`UPDATE hair_profiles SET norwood_stage = NULL, head_circumference_cm = NULL, colour = NULL,
               grey_percent = NULL, density_percent = NULL, product = NULL, attachment = NULL WHERE id = 'v1'`);
    expect(
      db.prepare("SELECT norwood_stage, colour, skin_and_allergies, technician_id FROM hair_profiles").get(),
    ).toEqual({ norwood_stage: null, colour: null, skin_and_allergies: null, technician_id: "t1" });
  });

  it("finds a person's versions, and a visit's, by an index", () => {
    const db = migrated();
    const planOf = (sql: string) => JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all());
    expect(planOf("SELECT * FROM hair_profiles WHERE person_id = 'p1' ORDER BY created_at DESC")).toContain(
      "hair_profiles_by_person",
    );
    expect(planOf("SELECT 1 FROM hair_profiles WHERE appointment_id = 'a1'")).toContain("hair_profiles_by_event");
  });
});
