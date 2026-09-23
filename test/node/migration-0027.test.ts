// Migration 0027 adds the pieces mirror, the two columns the dispatch board and
// the technician login read, and the technician a one-time code belongs to (the
// plan's P2-M4). What the schema itself must hold, whatever the code around it
// does. D1 is SQLite, so this applies the real migration files to an in-memory
// SQLite database. Every name and number is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

const AT = "2026-09-21T06:30:00.000Z";

function seeded(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) db.exec(readFileSync(`migrations/${file}`, "utf8"));
  db.exec(`INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client')`);
  db.exec(
    `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at)
     VALUES ('t1', 'resource-1', 'A Technician', 'AT', 1, 'Gurgaon', '+919810000009', '${AT}')`,
  );
  return db;
}

const insertPiece = (db: DatabaseSync, id: string, fsmId: string, code: string) =>
  db
    .prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES (?, ?, 'p1', ?, 'Standard base', '2026-07-01', '2027-02-26', ?)`,
    )
    .run(id, fsmId, code, AT);

let db: DatabaseSync;
beforeEach(() => {
  db = seeded();
});

describe("migration 0027", () => {
  it("keeps one row per FSM asset, so a re-read of the same piece does not double it", () => {
    insertPiece(db, "pc1", "asset-1", "MM-STD-4417-B");
    expect(() => insertPiece(db, "pc2", "asset-1", "MM-STD-4417-B")).toThrow(/UNIQUE/);
    insertPiece(db, "pc2", "asset-2", "MM-STD-4418-B");
    expect(db.prepare("SELECT COUNT(*) AS n FROM pieces").get()).toEqual({ n: 2 });
  });

  it("points a piece at a client and a visit that exist", () => {
    expect(() => {
      db.exec(
        `INSERT INTO pieces (id, fsm_id, person_id, piece_code, synced_at)
         VALUES ('pc9', 'asset-9', 'p404', 'MM-STD-0000-A', '${AT}')`,
      );
    }).toThrow(/FOREIGN KEY/);
    expect(() => {
      db.exec(
        `INSERT INTO pieces (id, fsm_id, person_id, piece_code, appointment_id, synced_at)
         VALUES ('pc9', 'asset-9', 'p1', 'MM-STD-0000-A', 'job404', '${AT}')`,
      );
    }).toThrow(/FOREIGN KEY/);
  });

  it("gives a technician the number he logs in with and the zone the board groups him by", () => {
    expect(db.prepare("SELECT zone, mobile_e164 FROM technicians WHERE id = 't1'").get()).toEqual({
      zone: "Gurgaon",
      mobile_e164: "+919810000009",
    });
  });

  it("keeps the two logins' challenges apart, and defaults an old row to the client's", () => {
    const challenge = (id: string, sql: string) => {
      db.exec(sql.replace("{id}", id));
    };
    challenge(
      "c1",
      `INSERT INTO otp_challenges (id, created_at, person_id, purpose, channel, code_hash, last_sent_at, expires_at)
       VALUES ('{id}', '${AT}', 'p1', 'login', 'whatsapp', 'hash', '${AT}', '${AT}')`,
    );
    challenge(
      "c2",
      `INSERT INTO otp_challenges (id, created_at, technician_login, technician_id, purpose, channel, code_hash,
         last_sent_at, expires_at)
       VALUES ('{id}', '${AT}', 1, 't1', 'login', 'whatsapp', 'hash', '${AT}', '${AT}')`,
    );
    expect(db.prepare("SELECT id FROM otp_challenges WHERE technician_login = 0").all()).toEqual([{ id: "c1" }]);
    expect(db.prepare("SELECT id FROM otp_challenges WHERE technician_login = 1").all()).toEqual([{ id: "c2" }]);
  });

  it("lets a technician's challenge name no technician, for a number FSM does not list", () => {
    db.exec(
      `INSERT INTO otp_challenges (id, created_at, technician_login, technician_id, purpose, channel, last_sent_at,
         expires_at)
       VALUES ('c3', '${AT}', 1, NULL, 'login', 'whatsapp', '${AT}', '${AT}')`,
    );
    expect(db.prepare("SELECT technician_id, code_hash FROM otp_challenges WHERE id = 'c3'").get()).toEqual({
      technician_id: null,
      code_hash: null,
    });
    expect(() => {
      db.exec(
        `INSERT INTO otp_challenges (id, created_at, technician_login, technician_id, purpose, channel, last_sent_at,
           expires_at)
         VALUES ('c4', '${AT}', 1, 't404', 'login', 'whatsapp', '${AT}', '${AT}')`,
      );
    }).toThrow(/FOREIGN KEY/);
  });
});
