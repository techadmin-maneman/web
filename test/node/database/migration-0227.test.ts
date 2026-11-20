// Migration 0227: what clients did before conversions were recorded is recorded as history, so Growth › Funnel counts
// it, and none of it is ever sent to Google or Meta. Every name here is made up.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { apply, databaseBefore, migrationNamed } from "./migrations.ts";

const THIS = migrationNamed("_attribution.sql");

const AT = "2026-10-20T06:30:00.000Z";

const visit = (id: string, person: string, type: string, start: string, status: string, deleted = "NULL") =>
  `INSERT INTO appointments (id, fsm_id, person_id, type, window_start, window_end, status, synced_at, first_seen_at,
     deleted_at)
     VALUES ('${id}', 'fsm-${id}', '${person}', '${type}', '${start}', '${start}', '${status}', '${AT}', '${start}',
       ${deleted})`;

const payment = (id: string, person: string, visitId: string, at: string, amount: number, kind = "visit") =>
  `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, amount_ex_gst, currency, status,
     kind, captured_at, created_at, updated_at)
     VALUES ('${id}', '${person}', '${visitId}', 'pay_${id}', ${String(amount)}, ${String(Math.round(amount / 1.18))},
       'INR', 'captured', '${kind}', '${at}', '${at}', '${at}')`;

function withHistory(): DatabaseSync {
  const db = databaseBefore(THIS);
  for (const sql of [
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p1', '${AT}', '+919810000001', 'Arjun Mehta')`,
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p2', '${AT}', '+919810000002', 'Kabir Rao')`,
    // Arjun: a consultation, then a first fit cancelled and one fitted, paid twice, and a late fee.
    visit("c1", "p1", "consultation", "2026-10-01T04:30:00.000Z", "completed"),
    visit("f0", "p1", "first_fit", "2026-10-05T04:30:00.000Z", "cancelled"),
    visit("f1", "p1", "first_fit", "2026-10-09T04:30:00.000Z", "completed"),
    payment("y1", "p1", "f1", "2026-10-09T08:00:00.000Z", 2_500_000),
    payment("y2", "p1", "f1", "2026-10-09T09:00:00.000Z", 500_000),
    payment("y3", "p1", "f1", "2026-10-10T09:00:00.000Z", 100_000, "late_fee"),
    // Kabir: a consultation deleted, another booked and not yet done.
    visit("c2", "p2", "consultation", "2026-10-02T04:30:00.000Z", "scheduled", `'${AT}'`),
    visit("c3", "p2", "consultation", "2026-10-25T04:30:00.000Z", "scheduled"),
    // A visit done that kept no start, from before migration 0169 required one: no time to count it at.
    `INSERT INTO people (id, created_at, mobile_e164, name) VALUES ('p3', '${AT}', '+919810000003', 'Vikram Rao')`,
    "DROP TRIGGER appointments_whole",
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, synced_at)
       VALUES ('c4', 'fsm-c4', 'p3', 'consultation', 'completed', '${AT}')`,
    // A payment whose notes named no one and whose contact matched no client: counted for no one.
    `INSERT INTO payments (id, razorpay_payment_id, amount, currency, status, kind, captured_at, created_at, updated_at)
       VALUES ('y4', 'pay_y4', 300000, 'INR', 'captured', 'visit', '${AT}', '${AT}', '${AT}')`,
  ]) {
    db.exec(sql);
  }
  apply(db, THIS);
  return db;
}

describe("migration 0227", () => {
  it("records each client's first consultation booked and done, and each visit's payment, as history", () => {
    const db = withHistory();
    expect(
      db
        .prepare(
          `SELECT event, subject_id, person_id, occurred_at, value_paise, attributed_channel, last_touch_channel
           FROM conversions ORDER BY person_id, occurred_at, event`,
        )
        .all(),
    ).toEqual([
      {
        event: "consult_booked",
        subject_id: "c1",
        person_id: "p1",
        occurred_at: "2026-10-01T04:30:00.000Z",
        value_paise: null,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
      {
        event: "consult_done",
        subject_id: "c1",
        person_id: "p1",
        occurred_at: "2026-10-01T04:30:00.000Z",
        value_paise: null,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
      {
        event: "first_fit_paid",
        subject_id: "y1",
        person_id: "p1",
        occurred_at: "2026-10-09T08:00:00.000Z",
        value_paise: 2_118_644,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
      {
        event: "service_paid",
        subject_id: "y2",
        person_id: "p1",
        occurred_at: "2026-10-09T09:00:00.000Z",
        value_paise: 423_729,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
      {
        event: "consult_booked",
        subject_id: "c3",
        person_id: "p2",
        occurred_at: "2026-10-25T04:30:00.000Z",
        value_paise: null,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
      // Booked, so counted as booked; done with no start, so not counted as done.
      {
        event: "consult_booked",
        subject_id: "c4",
        person_id: "p3",
        occurred_at: AT,
        value_paise: null,
        attributed_channel: "direct",
        last_touch_channel: "direct",
      },
    ]);
    db.close();
  });

  it("sends none of it to either platform", () => {
    const db = withHistory();
    expect(
      db
        .prepare(
          `SELECT DISTINCT meta_state, meta_error, meta_next_at, google_state, google_error, google_next_at
           FROM conversions`,
        )
        .all(),
    ).toEqual([
      {
        meta_state: "skipped",
        meta_error: "before_release",
        meta_next_at: null,
        google_state: "skipped",
        google_error: "before_release",
        google_next_at: null,
      },
    ]);
    db.close();
  });
});
