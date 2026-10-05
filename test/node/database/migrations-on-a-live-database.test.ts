// Migrations run against a database that already holds rows, with foreign keys
// on, as D1 runs them. A migration that only ever meets an empty schema passes
// checks it would fail in front of real data: migration 0025 rebuilds the leads
// table, and a try-on job points at a lead, so dropping that table breaks the
// reference. It passed locally, where nothing had been booked, and failed the
// staging deploy.
//
// This applies every migration in order, stopping partway to put the rows a
// working system would have, then applies the rest: Phase 1's lead and try-on,
// and Phase 2's fitted client, visit, payment, invite and technician, so every
// later migration meets both. Every name is made up.

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const MIGRATIONS = readdirSync("migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort();

const AT = "2026-09-21T06:30:00.000Z";

/** Phase 1's rows, as soon as the try-on tables exist. */
const PHASE_1 = [
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'A Client')`,
  `INSERT INTO leads (id, person_id, created_at, source, city, first_choice_window, loss_extent, request_id)
     VALUES ('l1', 'p1', '${AT}', 'form', 'Gurgaon', 'weekday_pm', 'crown', 'r1')`,
  // The reference that broke the rebuild: a try-on job belonging to that lead.
  `INSERT INTO tryon_jobs (id, created_at, upload_key, lead_id, state, photo_consent_version, photo_consent_at, ip_hash, request_id)
     VALUES ('j1', '${AT}', 'uploads/j1.jpg', 'l1', 'ready', 'photo-v1', '${AT}', 'a-hash', 'r1')`,
];

/**
 * Phase 2's rows, once the field-operations tables exist: a fitted client with
 * a session and an address, their first fit with its photograph, payment and
 * piece, the technician who came, with their phone and what it sent, and an
 * invite that earned the client credits.
 */
const PHASE_2 = [
  `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p2', '${AT}', '+919810000002', 'A Fitted Client')`,
  `INSERT INTO sessions (id, subject_kind, subject_id, created_at, last_seen_at, expires_at)
     VALUES ('s1', 'client', 'p2', '${AT}', '${AT}', '2026-10-21T06:30:00.000Z')`,
  `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode)
     VALUES ('a1', 'p2', '${AT}', '1 A Road', 'DLF Phase 1', 'Gurgaon', '122002')`,
  `INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at)
     VALUES ('t1', 'fsm-t1', 'A Technician', 'AT', 1, '${AT}')`,
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, fsm_status, fsm_modified_at, synced_at)
     VALUES ('ap1', 'fsm-ap1', 'p2', 'first_fit', '2026-09-22T03:30:00.000Z', '2026-09-22T06:30:00.000Z', 't1',
             'completed', 'Completed', '${AT}', '${AT}')`,
  `INSERT INTO visits (id, appointment_id, outcome, updated_at) VALUES ('v1', 'ap1', 'done', '${AT}')`,
  `INSERT INTO photo_sets (id, appointment_id, phase, created_at) VALUES ('ps1', 'ap1', 'after', '${AT}')`,
  `INSERT INTO photos (id, photo_set_id, angle, r2_key, content_type, bytes, taken_at, created_at)
     VALUES ('ph1', 'ps1', 'front', 'visits/ap1/after-front.jpg', 'image/jpeg', 1000, '${AT}', '${AT}')`,
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status, created_at, updated_at)
     VALUES ('pay1', 'p2', 'ap1', 'pay_1', 2500000, 'INR', 'captured', '${AT}', '${AT}')`,
  `INSERT INTO pieces (id, fsm_id, person_id, piece_code, appointment_id, synced_at)
     VALUES ('pc1', 'fsm-pc1', 'p2', 'MM-STD-4417-B', 'ap1', '${AT}')`,
  `INSERT INTO technician_devices (id, technician_id, device_id, created_at, last_seen_at)
     VALUES ('d1', 't1', 'phone-1', '${AT}', '${AT}')`,
  `INSERT INTO job_events (id, appointment_id, event_id, technician_id, device_id, kind, body, occurred_at, received_at, updated_at)
     VALUES ('je1', 'ap1', 'e1', 't1', 'd1', 'outcome', '{"outcome":"done"}', '${AT}', '${AT}', '${AT}')`,
  `INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('ARJUN1', 'p2', '${AT}', '${AT}')`,
  `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, created_at, updated_at)
     VALUES ('ra1', 'ARJUN1', 'p1', '${AT}', 'consultation', '${AT}', '${AT}')`,
  `INSERT INTO credit_ledger (id, person_id, kind, visits, source_kind, source_id, created_at)
     VALUES ('cl1', 'p2', 'grant', 3, 'referral', 'ra1', '${AT}')`,
];

/** The newest tables' rows: a friend's request for a consultation, and a technician's leave. */
const LATEST = [
  `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, referral_code, created_at)
     VALUES ('cr1', 'p1', '122002', '2026-10-01', 'morning', 'ARJUN1', '${AT}')`,
  `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
     VALUES ('tl1', 't1', '2026-10-02', '2026-10-03', 'ops@example.com', '${AT}')`,
];

/** The Zoho tokens in use, held in the one table every client's token went to. */
const ZOHO = [
  `INSERT INTO zoho_access_tokens (client, access_token, expires_at, refreshing_until)
     VALUES ('crm', 'a-token', '2026-09-21T07:30:00.000Z', '${AT}')`,
  `INSERT INTO zoho_access_tokens (client, access_token, expires_at) VALUES ('fsm', 'b-token', '2026-09-21T07:30:00.000Z')`,
];

/** Each set of rows goes in straight after the migration that creates the last of its tables. */
const SEEDS = [
  { after: "0003", rows: PHASE_1 },
  { after: "0027", rows: PHASE_2 },
  { after: "0034", rows: LATEST },
  { after: "0041", rows: ZOHO },
] as const;

/** The table each seeded row is in, and how many rows it gets. */
function seededTables(): Map<string, number> {
  const tables = new Map<string, number>();
  for (const statement of SEEDS.flatMap((seed) => seed.rows)) {
    const table = /INSERT INTO (\w+)/.exec(statement)?.[1] ?? "";
    tables.set(table, (tables.get(table) ?? 0) + 1);
  }
  return tables;
}

/** Applies each migration in order, putting each set of rows in once its tables exist. */
function migrate(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of MIGRATIONS) {
    // D1 applies each migration in one transaction: that is why the failed one rolled
    // back on staging, and it is what lets a rebuild defer its foreign key checks.
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${file}`, "utf8"));
    db.exec("COMMIT");
    const seed = SEEDS.find((candidate) => file.startsWith(candidate.after));
    for (const statement of seed?.rows ?? []) db.exec(statement);
  }
  return db;
}

describe("the migrations, against a database that is in use", () => {
  it("runs to the end with rows in place and foreign keys on", () => {
    for (const { after } of SEEDS)
      expect(
        MIGRATIONS.some((file) => file.startsWith(after)),
        after,
      ).toBe(true);
    const db = migrate();

    const lead = db.prepare("SELECT id, loss_extent FROM leads WHERE id = 'l1'").get() as Record<string, unknown>;
    expect(lead).toEqual({ id: "l1", loss_extent: "crown" });
    const job = db.prepare("SELECT lead_id FROM tryon_jobs WHERE id = 'j1'").get() as Record<string, unknown>;
    expect(job).toEqual({ lead_id: "l1" });

    // Nothing points at a row that is no longer there.
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("keeps every Phase 2 row the later migrations meet", () => {
    const db = migrate();
    for (const [table, rows] of seededTables()) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), table).toEqual({ n: rows });
    }
    const visit = db.prepare("SELECT outcome FROM visits WHERE appointment_id = 'ap1'").get();
    expect(visit).toEqual({ outcome: "done" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("takes a visit booked without FSM, under its own ID, for a client with a Books customer", () => {
    const db = migrate();
    db.exec(
      `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, technician_id, status, synced_at)
       VALUES ('ap2', 'ap2', 'p2', 'service', '2026-10-22T03:30:00.000Z', '2026-10-22T05:00:00.000Z', 't1',
               'scheduled', '${AT}')`,
    );
    db.exec("UPDATE people SET books_customer_id = 'customer-2' WHERE id = 'p2'");
    const booked = db.prepare("SELECT fsm_id, fsm_status, fsm_modified_at FROM appointments WHERE id = 'ap2'").get();
    expect(booked).toEqual({ fsm_id: "ap2", fsm_status: null, fsm_modified_at: null });
    const mirrored = db.prepare("SELECT fsm_status, fsm_modified_at FROM appointments WHERE id = 'ap1'").get();
    expect(mirrored).toEqual({ fsm_status: "Completed", fsm_modified_at: AT });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("counts an erased client's Books erasure from no tries, and keeps it once done", () => {
    const db = migrate();
    db.exec(`UPDATE people SET books_customer_id = 'customer-2', erased_at = '${AT}' WHERE id = 'p2'`);
    const due = db.prepare("SELECT books_erased_at, books_erasure_attempts FROM people WHERE id = 'p2'").get();
    expect(due).toEqual({ books_erased_at: null, books_erasure_attempts: 0 });
    db.exec(`UPDATE people SET books_erased_at = '${AT}' WHERE id = 'p2'`);
    const done = db.prepare("SELECT books_erased_at FROM people WHERE id = 'p2'").get();
    expect(done).toEqual({ books_erased_at: AT });
    db.close();
  });

  it("marks no client's Books customer as changed until their number or address changes", () => {
    const db = migrate();
    const person = db.prepare("SELECT books_details_changed_at FROM people WHERE id = 'p2'").get();
    expect(person).toEqual({ books_details_changed_at: null });
    db.close();
  });

  it("takes a hold ops made that the client pays for by a link, and keeps every other hold paid as it was", () => {
    const db = migrate();
    const hold = (id: string) =>
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, expires_at, created_at, updated_at)
       VALUES ('${id}', 'p2', 'service', '2026-10-22', 'morning', 't1', 0, 150000, 150000, 0, 'held', '${AT}',
               '${AT}', '${AT}')`;
    db.exec(hold("h1"));
    db.exec(hold("h2"));
    db.exec(
      "UPDATE slot_holds SET pay_by_link = 1, payment_link_id = 'plink_1', payment_link_url = 'u' WHERE id = 'h2'",
    );
    const holds = db.prepare("SELECT id, pay_by_link, payment_link_id FROM slot_holds ORDER BY id").all();
    expect(holds).toEqual([
      { id: "h1", pay_by_link: 0, payment_link_id: null },
      { id: "h2", pay_by_link: 1, payment_link_id: "plink_1" },
    ]);
    expect(() => {
      db.exec("UPDATE slot_holds SET payment_link_id = 'plink_1' WHERE id = 'h1'");
    }).toThrow();
    db.close();
  });

  // A booking made on the site has a date and a window of its own, and no rough
  // preference; it does say where the hair loss is, because its form asks.
  it("takes a booking's lead, which names a loss extent and no rough window", () => {
    const db = migrate();
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
    const db = migrate();
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
