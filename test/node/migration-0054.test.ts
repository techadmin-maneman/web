// Migration 0054: whose each task is, a task ops closed, an address given to ops,
// and what keeps the Tasks board's Consultation request and First fit to book
// reading only what can still be a task (docs/decisions/0092-task-owners.md).
// Applied to a database that already holds requests and visits, as staging's
// does, and then written to as the Worker deployed before it writes, which knows
// nothing of the flags. Every name and number is made up.
//
// The file is found by its name, not its number, which a migration merged first
// may move on.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.endsWith("_task_owners.sql")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";

/** A visit of a client's, with only what differs from a consultation done for the first client. */
function visit(db: DatabaseSync, id: string, fields: Record<string, string | null> = {}): void {
  const row: Record<string, string | null> = {
    id,
    fsm_id: `fsm-${id}`,
    person_id: "p1",
    type: "consultation",
    window_start: "2026-09-01T04:30:00.000Z",
    status: "completed",
    fsm_status: "Completed",
    fsm_modified_at: AT,
    synced_at: AT,
    ...fields,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO appointments (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...Object.values(row),
  );
}

function consultationAsked(db: DatabaseSync, id: string, personId: string): void {
  db.prepare(
    `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
     VALUES (?, ?, '122018', '2026-09-23', 'morning', ?)`,
  ).run(id, personId, AT);
}

function firstFitAsked(db: DatabaseSync, id: string, personId: string): void {
  db.prepare("INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at) VALUES (?, ?, NULL, ?)").run(
    id,
    personId,
    AT,
  );
}

/**
 * The database before this migration: p1 asked for a consultation and a first fit, had the consultation and was
 * fitted; p2 asked for both and had the consultation; p3 asked for a consultation, which was cancelled. Then this
 * migration.
 */
function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS.filter((name) => name < THIS)) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`INSERT INTO people (id, created_at, mobile_e164, name) VALUES
    ('p1', '${AT}', '+919810000001', 'A Client'), ('p2', '${AT}', '+919810000002', 'A Lead'),
    ('p3', '${AT}', '+919810000003', 'Another Lead');`);
  for (const person of ["p1", "p2", "p3"]) consultationAsked(db, `cr-${person}`, person);
  for (const person of ["p1", "p2"]) firstFitAsked(db, `ff-${person}`, person);
  visit(db, "c1");
  visit(db, "f1", { type: "first_fit", window_start: "2026-09-10T04:30:00.000Z" });
  visit(db, "c2", { person_id: "p2" });
  visit(db, "c3", { person_id: "p3", status: "cancelled", fsm_status: "Cancelled" });
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  return db;
}

const booked = (db: DatabaseSync) =>
  db.prepare("SELECT person_id, booked FROM consultation_requests ORDER BY person_id").all();

/** The same, worked out afresh from the appointments. */
const bookedNow = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT r.person_id, EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.person_id = r.person_id AND a.type = 'consultation' AND a.deleted_at IS NULL
            AND a.status NOT IN ('cancelled', 'terminated')) AS booked
       FROM consultation_requests r ORDER BY r.person_id`,
    )
    .all();

const fitted = (db: DatabaseSync) =>
  db.prepare("SELECT person_id, fitted_since FROM first_fit_requests ORDER BY person_id").all();

/** The same, worked out afresh from the appointments: a fit, service or replacement done after the consultation. */
const fittedNow = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT r.person_id, COALESCE(
         s.visit_start IS NOT NULL AND (s.consulted_start IS NULL OR s.visit_start > s.consulted_start), 0)
         AS fitted_since
       FROM first_fit_requests r LEFT JOIN last_visits_now s ON s.person_id = r.person_id ORDER BY r.person_id`,
    )
    .all();

describe("migration 0054: a consultation asked for", () => {
  it("is marked booked where the client has a consultation not called off", () => {
    const db = migrated();
    expect(booked(db)).toEqual([
      { person_id: "p1", booked: 1 },
      { person_id: "p2", booked: 1 },
      { person_id: "p3", booked: 0 },
    ]);
  });

  it("follows the client's consultations as they are booked, called off, moved, changed or deleted", () => {
    const db = migrated();
    const changes = [
      "UPDATE appointments SET status = 'scheduled', fsm_status = 'Scheduled' WHERE id = 'c3'",
      "UPDATE appointments SET status = 'terminated' WHERE id = 'c2'",
      "UPDATE appointments SET person_id = 'p2' WHERE id = 'c3'",
      "UPDATE appointments SET type = 'service' WHERE id = 'c1'",
      `UPDATE appointments SET deleted_at = '${AT}' WHERE id = 'c3'`,
      "UPDATE appointments SET deleted_at = NULL WHERE id = 'c3'",
      "DELETE FROM appointments WHERE id = 'c3'",
    ];
    for (const change of changes) {
      db.exec(change);
      expect(booked(db)).toEqual(bookedNow(db));
    }
    visit(db, "c4", { person_id: "p3", status: "scheduled", fsm_status: "Scheduled" });
    expect(booked(db)).toContainEqual({ person_id: "p3", booked: 1 });
  });

  it("is marked booked from the start when the client already has a consultation", () => {
    const db = migrated();
    db.exec("DELETE FROM consultation_requests WHERE person_id = 'p2'");
    consultationAsked(db, "cr-again", "p2");
    expect(booked(db)).toContainEqual({ person_id: "p2", booked: 1 });
  });
});

describe("migration 0054: a first fit asked for", () => {
  it("is marked fitted where the client has had a fit, service or replacement since the consultation", () => {
    const db = migrated();
    expect(fitted(db)).toEqual([
      { person_id: "p1", fitted_since: 1 },
      { person_id: "p2", fitted_since: 0 },
    ]);
  });

  it("follows the client's visits as each closes, is called off or deleted, and a later consultation", () => {
    const db = migrated();
    const changes = [
      "UPDATE appointments SET status = 'cancelled' WHERE id = 'f1'",
      "UPDATE appointments SET status = 'completed' WHERE id = 'f1'",
    ];
    for (const change of changes) {
      db.exec(change);
      expect(fitted(db)).toEqual(fittedNow(db));
    }
    visit(db, "f2", { person_id: "p2", type: "first_fit", window_start: "2026-09-12T04:30:00.000Z" });
    expect(fitted(db)).toEqual([
      { person_id: "p1", fitted_since: 1 },
      { person_id: "p2", fitted_since: 1 },
    ]);
    // A consultation after the fit: a first fit asked for is open again.
    visit(db, "c5", { window_start: "2026-09-20T04:30:00.000Z" });
    expect(fitted(db)).toContainEqual({ person_id: "p1", fitted_since: 0 });
    db.exec("DELETE FROM appointments WHERE id = 'f2'");
    expect(fitted(db)).toEqual(fittedNow(db));
  });

  it("is marked from the start for a client asking once already fitted, and kept when they ask again", () => {
    const db = migrated();
    db.exec("DELETE FROM first_fit_requests");
    firstFitAsked(db, "ff-again", "p1");
    firstFitAsked(db, "ff-new", "p3");
    expect(fitted(db)).toEqual([
      { person_id: "p1", fitted_since: 1 },
      { person_id: "p3", fitted_since: 0 },
    ]);
    // src/domain/next-visit.ts: asking again replaces the request, keeping its row.
    db.exec(`INSERT INTO first_fit_requests (id, person_id, preferred_window, created_at)
             VALUES ('ff-third', 'p1', 'morning', '${AT}')
             ON CONFLICT (person_id) DO UPDATE SET preferred_window = excluded.preferred_window`);
    expect(fitted(db)).toContainEqual({ person_id: "p1", fitted_since: 1 });
  });
});

describe("migration 0054: what is kept about a task", () => {
  it("keeps one owner and one closing a task, and an address's member of staff", () => {
    const db = migrated();
    const own = db.prepare(
      `INSERT INTO task_owners (task_group, subject_id, episode, owner, assigned_by, assigned_at)
       VALUES ('partial_visit', 'v1', '', ?, 'ops@maneman.in', '${AT}')`,
    );
    own.run("priya@maneman.in");
    expect(() => own.run("anil@maneman.in")).toThrow(/UNIQUE/);
    db.exec(`INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, given_to_staff)
             VALUES ('ad1', 'p1', '${AT}', 'House 7', 'Sector 65', 'Gurgaon', '122018', 'priya@maneman.in')`);
    expect(db.prepare("SELECT given_to_staff FROM addresses").get()).toEqual({ given_to_staff: "priya@maneman.in" });
  });
});
