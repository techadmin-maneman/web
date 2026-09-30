// What `node scripts/seed-technician-tester.ts --clear` deletes (scripts/lib/technician-tester.ts), run against the
// schema every migration builds, since D1 keeps foreign keys and a row left pointing at one deleted stops the
// whole clear. NOW is Monday 21 September 2026, 12 noon in India. Nothing here is a real person or number.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clearTester } from "../../scripts/lib/technician-tester.ts";
import { markDatabase, NOW } from "./helpers.ts";

const TECHNICIAN = "44444444-4444-4444-8444-444444444444";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  await markDatabase();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, updated_at, hand_written)
       VALUES (?1, 'tech-tester-1a2b3c4d', 'Test Technician', 'TT', 1, 'Gurgaon', '+919810000008', ?2, 1)`,
    ).bind(TECHNICIAN, at),
    env.DB.prepare(
      "INSERT INTO people (id, created_at, mobile_e164, name, contactable) VALUES (?1, ?2, '+919810000009', 'Staging test', 1)",
    ).bind(CLIENT, at),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'tech-tester-1a2b3c4d-job', ?2, 'service', 'terminated', 'Terminated', '2026-09-19T04:30:00.000Z',
         '2026-09-19T06:00:00.000Z', ?3, ?4, ?4)`,
    ).bind(JOB, CLIENT, TECHNICIAN, at),
  ]);
});

async function clear() {
  await env.DB.batch(clearTester([TECHNICIAN], [CLIENT]).map((statement) => env.DB.prepare(statement)));
}

const left = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

describe("clearing the technician tester", () => {
  it("clears the technician, his jobs and the invented client", async () => {
    await clear();
    expect([await left("technicians"), await left("appointments"), await left("people")]).toEqual([0, 0, 0]);
  });

  // A job the tester closed as a no-show, which ops charged and the invented client disputed
  // (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md).
  it("clears a no-show the client disputed", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, radius_m, passed, created_at)
         VALUES ('checkin-1', ?1, ?2, '2026-09-19T04:31:00.000Z', 28.4, 77.0, 200, 1, '2026-09-19T04:31:00.000Z')`,
      ).bind(JOB, TECHNICIAN),
      env.DB.prepare(
        `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
           charge, kept_amount, refund_amount, created_at)
         VALUES ('case-1', 'checkin-1', ?1, '2026-09-19T04:31:00.000Z', '2026-09-19T04:46:00.000Z',
           '2026-09-19T04:47:00.000Z', 'charged', 'visit', 200000, 0, '2026-09-19T04:47:00.000Z')`,
      ).bind(JOB),
      env.DB.prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at)
         VALUES ('dispute-1', 'case-1', ?1, 'I was home', ?2)`,
      ).bind(CLIENT, NOW.toISOString()),
    ]);

    await clear();

    expect([await left("no_show_disputes"), await left("no_show_cases"), await left("people")]).toEqual([0, 0, 0]);
  });
});
