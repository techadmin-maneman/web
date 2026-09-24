// Migrations run against a database that already holds rows, with foreign keys
// on, as D1 runs them. A migration that only ever meets an empty schema passes
// checks it would fail in front of real data: migration 0025 rebuilds the leads
// table, and a try-on job points at a lead, so dropping that table breaks the
// reference. It passed locally, where nothing had been booked, and failed the
// staging deploy.
//
// This applies every migration in order, stopping partway to put the rows a
// working system would have, then applies the rest. Every name is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

const AT = "2026-09-21T06:30:00.000Z";

/** The rows a live database holds by the time the later migrations arrive. */
const SEED = [
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client')`,
  `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, request_id)
     VALUES ('l1', 'p1', '${AT}', 'form', 'Gurgaon', 'weekday_pm', 'crown', 'r1')`,
  // The reference that broke the rebuild: a try-on job belonging to that lead.
  `INSERT INTO tryon_jobs (id, created_at, upload_key, lead_id, state, photo_consent_version, photo_consent_at, ip_hash, request_id)
     VALUES ('j1', '${AT}', 'uploads/j1.jpg', 'l1', 'ready', 'photo-v1', '${AT}', 'a-hash', 'r1')`,
];

/** Applies each migration in order, seeding after `seedAfter` has run. */
function migrate(seedAfter: string): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
    // D1 applies each migration in one transaction: that is why the failed one rolled
    // back on staging, and it is what lets a rebuild defer its foreign key checks.
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
    if (file === seedAfter) for (const statement of SEED) db.exec(statement);
  }
  return db;
}

describe("the migrations, against a database that is in use", () => {
  it("runs to the end with rows in place and foreign keys on", () => {
    // Seeded as soon as the try-on tables exist, so every later migration meets the rows.
    const seedAfter = MIGRATIONS.find((file) => file.startsWith("0003")) ?? "";
    expect(seedAfter).not.toBe("");
    const db = migrate(seedAfter);

    const lead = db.prepare("SELECT id, loss_extent FROM leads WHERE id = 'l1'").get() as Record<string, unknown>;
    expect(lead).toEqual({ id: "l1", loss_extent: "crown" });
    const job = db.prepare("SELECT lead_id FROM tryon_jobs WHERE id = 'j1'").get() as Record<string, unknown>;
    expect(job).toEqual({ lead_id: "l1" });

    // Nothing points at a row that is no longer there.
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  // A booking made on the site has a date and a window of its own, and no rough
  // preference; it does say where the hair loss is, because its form asks.
  it("takes a booking's lead, which names a loss extent and no rough window", () => {
    const seedAfter = MIGRATIONS.find((file) => file.startsWith("0003")) ?? "";
    const db = migrate(seedAfter);
    db.exec(
      `INSERT INTO leads (id, person_id, created_at, source, city, loss_extent, proposed_visit_date, request_id)
       VALUES ('l2', 'p1', '${AT}', 'form', 'Gurgaon', 'receding', '2026-09-25', 'r2')`,
    );
    const booked = db.prepare("SELECT first_choice_window, loss_extent FROM leads WHERE id = 'l2'").get();
    expect(booked).toEqual({ first_choice_window: null, loss_extent: "receding" });
    db.close();
  });

  // Migration 0031 swaps the column in place rather than rebuilding the table,
  // which is what withdrew 0025: the seeded try-on job above still points at its
  // lead afterwards, and the seeded lead keeps the extent it was written with.
  it("takes an invited friend's lead, which names no loss extent", () => {
    const seedAfter = MIGRATIONS.find((file) => file.startsWith("0003")) ?? "";
    const db = migrate(seedAfter);
    db.exec(
      `INSERT INTO leads (id, person_id, created_at, source, city, proposed_visit_date, request_id)
       VALUES ('l3', 'p1', '${AT}', 'form', 'Gurgaon', '2026-09-25', 'r3')`,
    );
    expect(db.prepare("SELECT loss_extent FROM leads WHERE id = 'l3'").get()).toEqual({ loss_extent: null });

    // The three answers are still the only ones the column takes.
    expect(() => {
      db.exec(
        `INSERT INTO leads (id, person_id, created_at, source, loss_extent, request_id)
         VALUES ('l4', 'p1', '${AT}', 'form', 'thinning', 'r4')`,
      );
    }).toThrow();
    db.close();
  });
});
