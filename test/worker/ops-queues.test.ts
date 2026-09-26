// Every queue on the ops console falls due on the day the Tasks board says it
// does (OPS-08). The same request once had two deadlines: an erasure was due
// "Today" on the Tasks board and had "5 days left" on Deletion requests, and a
// grievance, promised an answer in thirty days, was on no board at all. NOW is
// Monday 21 September 2026, 12 noon in India. Nothing here is a real person.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, request } from "./helpers.ts";

const ROHIT = "11111111-1111-4111-8111-111111111111";
const VIKRAM = "11111111-1111-4111-8111-111111111112";
const FIT = "22222222-2222-4222-8222-222222222221";
const VISIT = "22222222-2222-4222-8222-222222222222";
const HELD = "33333333-3333-4333-8333-333333333331";
const CASE = "33333333-3333-4333-8333-333333333332";
const CHANGE = "33333333-3333-4333-8333-333333333333";
const ERASURE = "33333333-3333-4333-8333-333333333334";
const GRIEVANCE = "33333333-3333-4333-8333-333333333335";

let ops: App;

interface Task {
  id: string;
  due: string;
}

/** The day each row falls due, by its id, as the Tasks board has it. */
async function tasksDue(): Promise<Map<string, string>> {
  const body = await (await request(ops, "/api/tasks")).json<{ groups: { tasks: Task[] }[] }>();
  return new Map(body.groups.flatMap((group) => group.tasks).map((task) => [task.id, task.due]));
}

/** The day each row falls due, by its id, as its own section has it. */
async function queuesDue(): Promise<Map<string, string>> {
  const read = async (path: string, key: string) =>
    ((await (await request(ops, path)).json<Record<string, unknown>>())[key] ?? []) as Task[];
  const rows = [
    ...(await read("/api/referrals/held", "held")),
    ...(await read("/api/no-shows", "cases")),
    ...(await read("/api/number-changes", "changes")),
    ...(await read("/api/deletion-requests", "requests")),
    ...(await read("/api/grievances", "grievances")),
  ];
  return new Map(rows.map((row) => [row.id, row.due]));
}

beforeEach(async () => {
  captureLogs();
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  const at = "2026-09-15T06:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name)
       VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'), (?2, ?3, '+919810000002', 'Vikram Sethi')`,
    ).bind(ROHIT, VIKRAM, at),
    env.DB.prepare(
      "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?1)",
    ).bind(at),
    env.DB.prepare(
      `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
         technician_id, fsm_modified_at, synced_at)
       VALUES (?1, 'fsm-fit', ?3, 'first_fit', 'completed', 'Completed', '2026-09-16T03:30:00.000Z',
                 '2026-09-16T06:30:00.000Z', 't1', ?4, ?4),
              (?2, 'fsm-visit', ?5, 'service', 'terminated', 'Terminated', '2026-09-19T03:30:00.000Z',
                 '2026-09-19T05:00:00.000Z', 't1', ?4, ?4)`,
    ).bind(FIT, VISIT, VIKRAM, at, ROHIT),
    // Held on the 17th: Rohit invited Vikram, and they share an address.
    env.DB.prepare(
      "INSERT INTO referral_codes (code, person_id, created_at, updated_at) VALUES ('RM4417', ?1, ?2, ?2)",
    ).bind(ROHIT, at),
    env.DB.prepare(
      `INSERT INTO referral_attributions (id, code, referred_person_id, first_touch_at, via, grant_state,
         first_fit_appointment_id, fraud_signals, created_at, updated_at)
       VALUES (?1, 'RM4417', ?2, ?3, 'consultation', 'held', ?4, '["shared_address"]', ?3,
         '2026-09-17T08:00:00.000Z')`,
    ).bind(HELD, VIKRAM, at, FIT),
    // Closed as a no-show on the 19th.
    env.DB.prepare(
      `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
       VALUES ('checkin-1', ?1, 't1', '2026-09-19T03:40:00.000Z', 28.4, 77.0, 40, 200, 1, '2026-09-19T03:40:00.000Z')`,
    ).bind(VISIT),
    env.DB.prepare(
      `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at, decision,
         created_at)
       VALUES (?1, 'checkin-1', ?2, '2026-09-19T03:40:00.000Z', '2026-09-19T03:55:00.000Z',
         '2026-09-19T03:56:00.000Z', 'undecided', '2026-09-19T03:56:00.000Z')`,
    ).bind(CASE, VISIT),
    // Asked for on the 18th, both codes entered on the 20th.
    env.DB.prepare(
      `INSERT INTO number_change_requests (id, person_id, created_at, new_mobile_e164, old_verified_at,
         new_verified_at, state)
       VALUES (?1, ?2, '2026-09-18T06:00:00.000Z', '+919810000099', '2026-09-20T05:00:00.000Z',
         '2026-09-20T05:10:00.000Z', 'awaiting_ops')`,
    ).bind(CHANGE, ROHIT),
    env.DB.prepare(
      "INSERT INTO deletion_requests (id, person_id, created_at, state) VALUES (?1, ?2, '2026-09-16T06:00:00.000Z', 'requested')",
    ).bind(ERASURE, VIKRAM),
    env.DB.prepare(
      `INSERT INTO grievances (id, person_id, text, state, created_at)
       VALUES (?1, ?2, 'Why do you keep my photographs?', 'open', '2026-09-10T06:00:00.000Z')`,
    ).bind(GRIEVANCE, ROHIT),
  ]);
});

describe("a queue's deadline", () => {
  it("is the Tasks board's, in every section that decides one", async () => {
    const onTheBoard = await tasksDue();
    const inTheQueues = await queuesDue();
    expect([...inTheQueues.keys()].sort()).toEqual([CASE, CHANGE, ERASURE, GRIEVANCE, HELD].sort());
    for (const [id, due] of inTheQueues) expect(due, id).toBe(onTheBoard.get(id));
  });

  it("moves in every section at once when ops change an allowance", async () => {
    const hours = { erasure_request: 24, grievance: 72 };
    const set = await request(ops, "/api/settings/task_sla_hours", {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify({
        value: {
          untold_move: 4,
          consultation_request: 48,
          replacement_order: 48,
          referral_review: 48,
          no_show_decision: 48,
          number_change: 48,
          draft_invoice: 48,
          erasure_unfinished: 48,
          ...hours,
        },
      }),
    });
    expect(set.status).toBe(200);

    // A route reads the settings through its app's own cache, so a fresh app reads what was just set.
    ops = appFor("local", fakeDependencies(), {}, "ops");
    const inTheQueues = await queuesDue();
    expect(inTheQueues.get(ERASURE)).toBe("2026-09-17T06:00:00.000Z");
    expect(inTheQueues.get(GRIEVANCE)).toBe("2026-09-13T06:00:00.000Z");
    const onTheBoard = await tasksDue();
    for (const [id, due] of inTheQueues) expect(due, id).toBe(onTheBoard.get(id));
  });

  it("counts a number change from when both codes were in, as the Tasks board does", async () => {
    expect((await queuesDue()).get(CHANGE)).toBe("2026-09-22T05:10:00.000Z");
  });

  // Board C1 writes how long a grant has been held ("3 days held"), not the day of the first fit (OPS-16).
  it("says when a held grant started waiting", async () => {
    const held = await (await request(ops, "/api/referrals/held")).json<{ held: Record<string, unknown>[] }>();
    expect(held.held[0]).toMatchObject({ held_since: "2026-09-17T08:00:00.000Z", due: "2026-09-19T08:00:00.000Z" });
  });
});
