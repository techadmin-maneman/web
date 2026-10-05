// Migration 0060: the flags that keep the Tasks board's Replacement order and
// Visit left partly done reading only what can still be a task. Applied to a
// database that already holds pieces and visits, as staging's does, and then
// written to as the Worker deployed before it writes, which knows nothing of the
// flags. Every name and number is made up.
//
// The file is found by its name, not its number, which a migration merged first
// may move on.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();
const THIS = MIGRATIONS.find((file) => file.endsWith("_flat_task_reads.sql")) ?? "";

const AT = "2026-09-21T06:30:00.000Z";
const DUE = "2026-09-01T00:00:00.000Z";

/** A visit of a client's, with only what differs from a service done for the first client. */
function visit(db: DatabaseSync, id: string, fields: Record<string, string | null> = {}): void {
  const row: Record<string, string | null> = {
    id,
    fsm_id: `fsm-${id}`,
    person_id: "p1",
    type: "service",
    window_start: "2026-08-01T04:30:00.000Z",
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

function piece(db: DatabaseSync, id: string, personId: string, dueAt: string | null): void {
  db.prepare(
    `INSERT INTO pieces (id, fsm_id, person_id, piece_code, fitted_at, replacement_due_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `fsm-${id}`, personId, `MM-${id}`, AT, dueAt, AT);
}

function partialVisit(db: DatabaseSync, id: string, appointmentId: string): void {
  db.prepare("INSERT INTO visits (id, appointment_id, outcome, partial_reason, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    appointmentId,
    "partial",
    "time",
    AT,
  );
}

const booked = (db: DatabaseSync, pieceId: string) =>
  (db.prepare("SELECT replacement_booked FROM pieces WHERE id = ?").get(pieceId) as { replacement_booked: number })
    .replacement_booked;

const followedUp = (db: DatabaseSync, visitId: string) =>
  (db.prepare("SELECT followed_up FROM visits WHERE id = ?").get(visitId) as { followed_up: number }).followed_up;

/**
 * The database before this migration: p1's piece fell due and a replacement was booked after, and p1's partial
 * visit was followed by another; p2's piece fell due with nothing booked, and p2's partial visit is their last.
 * Then this migration.
 */
function migrated(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const before = MIGRATIONS.slice(0, MIGRATIONS.indexOf(THIS));
  for (const file of before) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  for (const id of ["p1", "p2"]) {
    db.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?, ?, ?, ?)").run(
      id,
      AT,
      `+9198100000${id.slice(1)}`,
      `Client ${id}`,
    );
  }
  piece(db, "piece-1", "p1", DUE);
  visit(db, "rep-1", { type: "replacement", window_start: "2026-09-05T04:30:00.000Z" });
  visit(db, "part-a", { window_start: "2026-07-01T04:30:00.000Z" });
  partialVisit(db, "v-a", "part-a");
  piece(db, "piece-2", "p2", DUE);
  visit(db, "part-b", { person_id: "p2", window_start: "2026-08-15T04:30:00.000Z" });
  partialVisit(db, "v-b", "part-b");
  db.exec(readFileSync(`migrations/${THIS}`, "utf8"));
  return db;
}

describe("migration 0060: a piece's replacement booked", () => {
  it("is filled from the visits already there", () => {
    const db = migrated();
    expect([booked(db, "piece-1"), booked(db, "piece-2")]).toEqual([1, 0]);
  });

  it("follows a replacement booked, moved before the piece fell due, cancelled and taken out", () => {
    const db = migrated();
    visit(db, "rep-2", { person_id: "p2", type: "replacement", window_start: "2026-09-10T04:30:00.000Z" });
    expect(booked(db, "piece-2")).toBe(1);

    db.prepare("UPDATE appointments SET window_start = ? WHERE id = 'rep-2'").run("2026-08-20T04:30:00.000Z");
    expect(booked(db, "piece-2")).toBe(0);

    db.prepare("UPDATE appointments SET window_start = ? WHERE id = 'rep-2'").run("2026-09-12T04:30:00.000Z");
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'rep-2'").run();
    expect(booked(db, "piece-2")).toBe(0);

    db.prepare("UPDATE appointments SET status = 'scheduled' WHERE id = 'rep-2'").run();
    expect(booked(db, "piece-2")).toBe(1);
    db.prepare("UPDATE appointments SET deleted_at = ? WHERE id = 'rep-2'").run(AT);
    expect(booked(db, "piece-2")).toBe(0);

    db.prepare("DELETE FROM appointments WHERE id = 'rep-1'").run();
    expect(booked(db, "piece-1")).toBe(0);
  });

  it("follows the mirror's upsert, and a piece written or given a new due date after the replacement", () => {
    const db = migrated();
    db.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, status, fsm_status, fsm_modified_at,
         synced_at)
       VALUES ('rep-2', 'fsm-rep-2', 'p2', 'replacement', '2026-09-10T04:30:00.000Z', 'scheduled', 'Scheduled', ?, ?)
       ON CONFLICT (fsm_id) DO UPDATE SET status = excluded.status, window_start = excluded.window_start`,
    ).run(AT, AT);
    expect(booked(db, "piece-2")).toBe(1);

    piece(db, "piece-3", "p2", "2026-09-08T00:00:00.000Z");
    expect(booked(db, "piece-3")).toBe(1);
    db.prepare("UPDATE pieces SET replacement_due_at = ? WHERE id = 'piece-3'").run("2026-12-01T00:00:00.000Z");
    expect(booked(db, "piece-3")).toBe(0);
  });

  it("leaves a piece of another client's alone", () => {
    const db = migrated();
    visit(db, "rep-2", { person_id: "p2", type: "replacement", window_start: "2026-09-10T04:30:00.000Z" });
    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'rep-1'").run();
    expect([booked(db, "piece-1"), booked(db, "piece-2")]).toEqual([0, 1]);
  });
});

describe("migration 0060: a partial visit followed up", () => {
  it("is filled from the visits already there", () => {
    const db = migrated();
    expect([followedUp(db, "v-a"), followedUp(db, "v-b")]).toEqual([1, 0]);
  });

  it("follows a later visit booked, cancelled, moved before it and taken out", () => {
    const db = migrated();
    visit(db, "next-b", { person_id: "p2", window_start: "2026-10-01T04:30:00.000Z", status: "scheduled" });
    expect(followedUp(db, "v-b")).toBe(1);

    db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = 'next-b'").run();
    expect(followedUp(db, "v-b")).toBe(0);

    db.prepare("UPDATE appointments SET status = 'scheduled', window_start = ? WHERE id = 'next-b'").run(
      "2026-08-01T04:30:00.000Z",
    );
    expect(followedUp(db, "v-b")).toBe(0);

    db.prepare("UPDATE appointments SET window_start = ? WHERE id = 'next-b'").run("2026-10-01T04:30:00.000Z");
    expect(followedUp(db, "v-b")).toBe(1);
    db.prepare("DELETE FROM appointments WHERE id = 'next-b'").run();
    expect(followedUp(db, "v-b")).toBe(0);
  });

  it("follows a later visit moved to another client, and a visit becoming partial after one", () => {
    const db = migrated();
    visit(db, "next-b", { person_id: "p2", window_start: "2026-10-01T04:30:00.000Z", status: "scheduled" });
    db.prepare("UPDATE appointments SET person_id = 'p1' WHERE id = 'next-b'").run();
    expect(followedUp(db, "v-b")).toBe(0);

    visit(db, "done-b", { person_id: "p2", window_start: "2026-08-10T04:30:00.000Z" });
    visit(db, "after-b", { person_id: "p2", window_start: "2026-08-12T04:30:00.000Z" });
    db.prepare("INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES ('v-c', 'done-b', 'done', ?)").run(
      AT,
    );
    db.prepare("UPDATE visits SET outcome = 'partial' WHERE id = 'v-c'").run();
    expect(followedUp(db, "v-c")).toBe(1);
  });
});
