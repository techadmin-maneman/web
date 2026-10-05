// Migration 0053: what each place holds, and each client's last visits, kept by
// the database as the rows behind them are written (docs/decisions/0087-consumables-and-stock.md,
// 0086-the-next-visit-is-offered.md). Applied to a database that already holds
// a ledger and visits, as staging's does, and then written to as the Worker
// deployed before it writes, which knows nothing of either. Every name and
// number is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("0053_");

const AT = "2026-09-21T06:30:00.000Z";

/** A row of the ledger, with only what differs from a delivery into the store. */
function movement(db: DatabaseSync, fields: Record<string, string | number | null>): string {
  const row: Record<string, string | number | null> = {
    id: crypto.randomUUID(),
    consumable_code: "tape_strips",
    location: "central",
    technician_id: null,
    quantity: 10,
    reason: "received",
    actor_kind: "staff",
    actor: "ops@maneman.in",
    created_at: AT,
    ...fields,
  };
  const columns = Object.keys(row);
  db.prepare(`INSERT INTO stock_movements (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(
    ...Object.values(row),
  );
  return String(row.id);
}

/** A visit of a client's, with only what differs from a service done. */
function visit(db: DatabaseSync, id: string, fields: Record<string, string | null>): void {
  const row: Record<string, string | null> = {
    id,
    fsm_id: `fsm-${id}`,
    person_id: "p1",
    type: "service",
    window_start: AT,
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

/** The database before this migration, with a ledger and visits; then this migration. */
function migrated(): DatabaseSync {
  const db = databaseBefore(THIS);
  db.exec(`
    INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'r1', 'Imran', 'IQ', 1, '${AT}');
    INSERT INTO people (id, created_at, mobile_e164, name) VALUES
      ('p1', '${AT}', '+919810000001', 'A Client'), ('p2', '${AT}', '+919810000002', 'A Lead'),
      ('p3', '${AT}', '+919810000003', 'Another Client');
    INSERT INTO consumables (code, name, unit, unit_cost, created_at, updated_at)
      VALUES ('tape_strips', 'Tape strips', 'strip', 1200, '${AT}', '${AT}');`);
  movement(db, { quantity: 100 });
  movement(db, { quantity: -30, reason: "transferred", transfer_id: "tr1" });
  movement(db, { location: "kit", technician_id: "t1", quantity: 30, reason: "transferred", transfer_id: "tr1" });
  movement(db, { location: "kit", technician_id: "t1", quantity: -2, reason: "counted", created_at: "2026-09-22" });
  visit(db, "c1", { type: "consultation", window_start: "2026-05-01T04:30:00.000Z" });
  visit(db, "a1", { type: "first_fit", window_start: "2026-06-01T04:30:00.000Z" });
  visit(db, "a2", { window_start: "2026-07-01T04:30:00.000Z" });
  visit(db, "a3", { window_start: "2026-08-01T04:30:00.000Z", status: "cancelled", fsm_status: "Cancelled" });
  visit(db, "c2", { person_id: "p2", type: "consultation", window_start: "2026-09-01T04:30:00.000Z" });
  apply(db, THIS);
  return db;
}

const balances = (db: DatabaseSync) =>
  db.prepare("SELECT place, quantity, counted_at FROM stock_balances ORDER BY place").all();

/** What the ledger's rows sum to, place by place, as the balances must hold. */
const sums = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT COALESCE(technician_id, 'central') AS place, SUM(quantity) AS quantity,
         MAX(CASE WHEN reason = 'counted' THEN created_at END) AS counted_at
       FROM stock_movements GROUP BY technician_id ORDER BY place`,
    )
    .all();

const lastVisits = (db: DatabaseSync) =>
  db.prepare("SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits ORDER BY person_id").all();

/** The same, worked out afresh from the appointments, for each client the summary holds. */
const workedOut = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT person_id, visit_id, visit_start, consulted_start FROM last_visits_now
       WHERE person_id IN (SELECT person_id FROM last_visits) ORDER BY person_id`,
    )
    .all();

describe("migration 0053: the balances", () => {
  it("starts each place at the sum of its rows, with when it last counted", () => {
    const db = migrated();
    expect(balances(db)).toEqual([
      { place: "central", quantity: 70, counted_at: null },
      { place: "t1", quantity: 28, counted_at: "2026-09-22" },
    ]);
  });

  it("moves a place's balance with each row the Worker writes, whichever Worker it is", () => {
    const db = migrated();
    movement(db, { quantity: 5 });
    movement(db, { location: "kit", technician_id: "t1", quantity: 1, reason: "counted", created_at: "2026-09-23" });
    movement(db, { location: "kit", technician_id: "t1", quantity: -3, reason: "written_off", note: "Burst" });

    expect(balances(db)).toEqual([
      { place: "central", quantity: 75, counted_at: null },
      { place: "t1", quantity: 26, counted_at: "2026-09-23" },
    ]);
    expect(balances(db)).toEqual(sums(db));
  });

  it("keeps the later of two counts as when a place last counted, whichever lands first", () => {
    const db = migrated();
    const count = { location: "kit", technician_id: "t1", quantity: 0, reason: "counted" };
    movement(db, { ...count, created_at: "2026-09-25T06:30:00.000Z" });
    movement(db, { ...count, created_at: "2026-09-24T06:30:00.000Z" });

    expect(balances(db)).toContainEqual({ place: "t1", quantity: 28, counted_at: "2026-09-25T06:30:00.000Z" });
    expect(balances(db)).toEqual(sums(db));
  });

  it("starts a place's balance with its first row", () => {
    const db = migrated();
    db.exec(`INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
      VALUES ('t2', 'r2', 'Sameer', 'SB', 1, '${AT}')`);
    movement(db, { location: "kit", technician_id: "t2", quantity: 4, reason: "counted" });

    expect(balances(db)).toContainEqual({ place: "t2", quantity: 4, counted_at: AT });
  });

  it("gives a place back what a row taken out of the ledger moved, as the staging fixtures take theirs", () => {
    const db = migrated();
    const count = movement(db, {
      location: "kit",
      technician_id: "t1",
      quantity: 2,
      reason: "counted",
      created_at: "2026-09-24",
    });
    db.prepare("DELETE FROM stock_movements WHERE id = ?").run(count);

    expect(balances(db)).toEqual(sums(db));
    expect(balances(db)).toContainEqual({ place: "t1", quantity: 28, counted_at: "2026-09-22" });
  });

  it("refuses to change a row, which would leave its balance behind", () => {
    const db = migrated();
    expect(() => {
      db.exec("UPDATE stock_movements SET quantity = 1");
    }).toThrow(/append-only/);
  });
});

describe("migration 0053: each client's last visits", () => {
  it("starts from the visits done: the last fit, service or replacement, and the last consultation", () => {
    const db = migrated();
    expect(lastVisits(db)).toEqual([
      {
        person_id: "p1",
        visit_id: "a2",
        visit_start: "2026-07-01T04:30:00.000Z",
        consulted_start: "2026-05-01T04:30:00.000Z",
      },
      { person_id: "p2", visit_id: null, visit_start: null, consulted_start: "2026-09-01T04:30:00.000Z" },
    ]);
  });

  it("follows each visit as it closes, is called off, moves, changes hands or is deleted", () => {
    const db = migrated();
    visit(db, "a4", { window_start: "2026-09-01T04:30:00.000Z", status: "scheduled", fsm_status: "Scheduled" });
    expect(lastVisits(db)).toEqual(workedOut(db));
    const changes = [
      "UPDATE appointments SET status = 'completed' WHERE id = 'a4'",
      "UPDATE appointments SET window_start = '2026-09-02T04:30:00.000Z' WHERE id = 'a4'",
      "UPDATE appointments SET status = 'cancelled' WHERE id = 'a2'",
      "UPDATE appointments SET type = 'replacement' WHERE id = 'a1'",
      "UPDATE appointments SET person_id = 'p3' WHERE id = 'a4'",
      `UPDATE appointments SET deleted_at = '${AT}' WHERE id = 'a1'`,
      "UPDATE appointments SET deleted_at = NULL WHERE id = 'a1'",
      "DELETE FROM appointments WHERE id = 'c1'",
    ];
    for (const change of changes) {
      db.exec(change);
      expect(lastVisits(db)).toEqual(workedOut(db));
    }
    expect(lastVisits(db)).toContainEqual({
      person_id: "p3",
      visit_id: "a4",
      visit_start: "2026-09-02T04:30:00.000Z",
      consulted_start: null,
    });
    expect(lastVisits(db)).toContainEqual({
      person_id: "p1",
      visit_id: "a1",
      visit_start: "2026-06-01T04:30:00.000Z",
      consulted_start: null,
    });
  });

  // src/domain/fsm-mirror.ts writes each appointment FSM holds so, and src/domain/bookings.ts the visit it booked.
  it("follows a visit the mirror closes, or first writes already done, through its insert or update by FSM's ID", () => {
    const db = migrated();
    const mirror = db.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, status, fsm_status, fsm_modified_at,
         synced_at)
       VALUES (?, ?, 'p1', 'service', ?, ?, ?, '${AT}', '${AT}')
       ON CONFLICT (fsm_id) DO UPDATE SET person_id = excluded.person_id, type = excluded.type,
         window_start = excluded.window_start, status = excluded.status, fsm_status = excluded.fsm_status`,
    );

    mirror.run("new-id", "fsm-a4", "2026-09-10T04:30:00.000Z", "scheduled", "Scheduled");
    expect(lastVisits(db)).toContainEqual(expect.objectContaining({ person_id: "p1", visit_id: "a2" }));
    mirror.run("another-id", "fsm-a4", "2026-09-10T04:30:00.000Z", "completed", "Completed");
    expect(lastVisits(db)).toContainEqual(
      expect.objectContaining({ person_id: "p1", visit_id: "new-id", visit_start: "2026-09-10T04:30:00.000Z" }),
    );
    mirror.run("a5", "fsm-a5", "2026-09-20T04:30:00.000Z", "completed", "Completed");
    expect(lastVisits(db)).toContainEqual(expect.objectContaining({ person_id: "p1", visit_id: "a5" }));
    expect(lastVisits(db)).toEqual(workedOut(db));
  });

  it("writes nothing for a visit the mirror writes again as it was", () => {
    const db = migrated();
    const before = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    db.exec(`UPDATE appointments SET status = 'completed', window_start = window_start, synced_at = '${AT}'
             WHERE id = 'a2'`);
    const after = (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    expect(after - before).toBe(1);
  });
});
