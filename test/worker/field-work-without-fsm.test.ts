// A technician's day where our own database holds the record of field work (FSM_PROVIDER "none"): each step, piece and
// move is written in the request that makes it, and nothing reaches FSM, whose every call here fails. NOW is Monday
// 21 September 2026, 12 noon in India; today's job is at 13:00. Every name, number and label here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "../../apps/tech/src/store/uuidv7.ts";
import { moveJob } from "../../src/domain/dispatch.ts";
import { openTechnicianSession } from "../../src/domain/technicians.ts";
import { eraseBooksCustomers } from "../../src/domain/books-erasure.ts";
import { createCallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../src/providers/books.ts";
import { CRON_JOBS, runCronJobs } from "../../src/scheduled/cron.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  fsmSwitchedOff,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  PROVIDERS_FOR,
  request,
  type TestDependencies,
} from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const NEIGHBOUR = "11111111-1111-4111-8111-111111111112";
const TODAY_JOB = "22222222-2222-4222-8222-222222222221";
const OTHER_JOB = "22222222-2222-4222-8222-222222222223";
/** Imran and Sameer, made up. */
const IMRAN = "33333333-3333-4333-8333-333333333331";
const SAMEER = "33333333-3333-4333-8333-333333333332";

/** About 90 m from the client's door: inside the geofence. */
const AT_THE_DOOR = { lat: 28.3988, lng: 77.07 };

/** Today's job starts at 13:00 in India. */
const TODAY_START = new Date("2026-09-21T07:30:00.000Z");
const minutesAfterStart = (minutes: number) => new Date(TODAY_START.getTime() + minutes * 60_000);
/** The event ID the app makes for a write queued that many minutes after the start. */
const uuidv7At = (minutes: number) => uuidv7(minutesAfterStart(minutes).getTime());

let fsmQueue: ReturnType<typeof fakeQueue>;
let messageQueue: ReturnType<typeof fakeQueue>;
let cookie: string;

/** Dependencies with FSM switched off, as FSM_PROVIDER "none" makes them. */
const withoutFsm = (overrides: Parameters<typeof fakeDependencies>[0] = {}): TestDependencies =>
  fakeDependencies({ fsm: fsmSwitchedOff(), ...overrides });

const bindings = () => ({ FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

/** A write from the technician's phone that reaches the API at `at`, as a phone replaying its outbox does. */
const postAt = (at: Date, path: string, body: unknown, eventId: string) =>
  request(
    appFor("local", withoutFsm({ now: () => at }), {}, "tech", PROVIDERS_FOR.ours),
    path,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://maneman.test",
        "Content-Type": "application/json",
        "X-Client-Event-Id": eventId,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    bindings(),
  );

/** A write from the console. */
const opsPost = (path: string, body: unknown, deps: TestDependencies = withoutFsm()) =>
  request(
    appFor("local", deps, {}, "ops", PROVIDERS_FOR.ours),
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** A visit booked without FSM: its FSM ID is its own, and it has no work order and no FSM status. */
async function bookedWithoutFsm(id: string, options: { start: string; type?: string; technician?: string }) {
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, tier, status, window_start, window_end, technician_id,
       service_city, service_pincode, synced_at)
     VALUES (?1, ?1, ?2, ?3, 'standard', 'scheduled', ?4, ?5, ?6, 'Gurgaon', '122018', ?7)`,
  )
    .bind(
      id,
      PERSON,
      options.type ?? "service",
      options.start,
      new Date(Date.parse(options.start) + 90 * 60_000).toISOString(),
      options.technician ?? IMRAN,
      NOW.toISOString(),
    )
    .run();
}

/** Each step, its body, and the minute after the start the phone took it, sent together at `sentAt`. */
async function work(sentAt: Date, jobId: string, steps: readonly (readonly [string, unknown, number])[]) {
  for (const [step, body, minute] of steps) {
    const answer = await postAt(sentAt, `/api/tech/jobs/${jobId}/${step}`, body, uuidv7At(minute));
    expect(answer.status, `${step} at minute ${String(minute)}`).toBeLessThan(300);
  }
}

/** A service visit from the check-in to the after photographs, worked from 13:02. */
const UP_TO_THE_OUTCOME = [
  ["checkin", AT_THE_DOOR, 2],
  ["start", undefined, 5],
  ["photos", { phase: "before" }, 10],
  ["checklist", { done: ["piece_removed"] }, 40],
  ["consumables", { items: [] }, 45],
  ["photos", { phase: "after" }, 75],
] as const;

const statusOf = async (id: string) =>
  (await env.DB.prepare("SELECT status FROM appointments WHERE id = ?1").bind(id).first<{ status: string }>())?.status;

const visitRowOf = (id: string) =>
  env.DB.prepare(
    "SELECT started_at, ended_at, duration_minutes, outcome, partial_reason FROM visits WHERE appointment_id = ?1",
  )
    .bind(id)
    .first();

const writeStatesOf = async (id: string) =>
  (
    await env.DB.prepare(
      "SELECT DISTINCT fsm_write_state AS state FROM job_events WHERE appointment_id = ?1 ORDER BY state",
    )
      .bind(id)
      .all<{ state: string }>()
  ).results.map((row) => row.state);

beforeEach(async () => {
  await markDatabase();
  fsmQueue = fakeQueue();
  messageQueue = fakeQueue();
  const at = NOW.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO technicians (id, fsm_id, name, initials, active, zone, mobile_e164, hand_written, updated_at)
       VALUES (?1, ?1, 'Imran Qureshi', 'IQ', 1, 'Gurgaon', '+919810000009', 1, ?3),
              (?2, ?2, 'Sameer Bhatt', 'SB', 1, 'Gurgaon', '+919810000008', 1, ?3)`,
    ).bind(IMRAN, SAMEER, at),
    env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name)
       VALUES (?1, ?3, '+919810000001', 'Rohit Malhotra'), (?2, ?3, '+919810000002', 'Vikram Sethi')`,
    ).bind(PERSON, NEIGHBOUR, at),
    env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, locality, city, pincode, lat, lng, geocoded_at)
       VALUES ('addr-1', ?1, ?2, 'House 7', 'Sector 65', 'Gurgaon', '122018', 28.398, 77.07, ?2)`,
    ).bind(PERSON, at),
  ]);
  await bookedWithoutFsm(TODAY_JOB, { start: TODAY_START.toISOString() });
  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

describe("a technician's steps, without FSM", () => {
  it("move the visit on as each lands, and close it completed with the duration the phone measured", async () => {
    // Worked from 13:02 with no signal, and sent at 14:30 in one go.
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, [["checkin", AT_THE_DOOR, 2]]);
    expect(await statusOf(TODAY_JOB)).toBe("dispatched");
    await work(sentAt, TODAY_JOB, [["start", undefined, 5]]);
    expect(await statusOf(TODAY_JOB)).toBe("in_progress");

    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME.slice(2));
    const closed = await postAt(sentAt, `/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, uuidv7At(80));

    expect(closed.status).toBe(202);
    expect(await closed.json()).toMatchObject({ replayed: false, fsm_write_state: "written" });
    expect(await statusOf(TODAY_JOB)).toBe("completed");
    expect(await visitRowOf(TODAY_JOB)).toEqual({
      started_at: minutesAfterStart(5).toISOString(),
      ended_at: minutesAfterStart(80).toISOString(),
      duration_minutes: 75,
      outcome: "done",
      partial_reason: null,
    });
    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
    expect(fsmQueue.sent).toEqual([]);
  });

  it("close a partial job as terminated, with the technician's reason", async () => {
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME);

    const closed = await postAt(
      sentAt,
      `/api/tech/jobs/${TODAY_JOB}/outcome`,
      { outcome: "partial", reason: "client_stopped_it" },
      uuidv7At(60),
    );

    expect(closed.status).toBe(202);
    expect(await statusOf(TODAY_JOB)).toBe("terminated");
    expect(await visitRowOf(TODAY_JOB)).toMatchObject({
      duration_minutes: 55,
      outcome: "partial",
      partial_reason: "client_stopped_it",
    });
  });

  it("close a no-show as terminated, never started", async () => {
    await work(NOW, TODAY_JOB, [["checkin", AT_THE_DOOR, -30]]);

    // Sixteen minutes after the booked start, the wait has run.
    const closed = await postAt(minutesAfterStart(16), `/api/tech/jobs/${TODAY_JOB}/no-show`, undefined, "event-ns-01");

    expect(closed.status).toBe(200);
    expect(await statusOf(TODAY_JOB)).toBe("terminated");
    expect(await visitRowOf(TODAY_JOB)).toEqual({
      started_at: null,
      ended_at: minutesAfterStart(16).toISOString(),
      duration_minutes: null,
      outcome: "no_show",
      partial_reason: null,
    });
    expect(fsmQueue.sent).toEqual([]);
  });

  it("change nothing twice when the phone replays its outbox", async () => {
    const sentAt = minutesAfterStart(90);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME);
    const eventId = uuidv7At(80);
    await postAt(sentAt, `/api/tech/jobs/${TODAY_JOB}/outcome`, { outcome: "done" }, eventId);

    const replayed = await postAt(
      minutesAfterStart(120),
      `/api/tech/jobs/${TODAY_JOB}/outcome`,
      { outcome: "done" },
      eventId,
    );

    expect(await replayed.json()).toMatchObject({ replayed: true, fsm_write_state: "written" });
    const visits = await env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE appointment_id = ?1")
      .bind(TODAY_JOB)
      .first<{ n: number }>();
    expect(visits?.n).toBe(1);
    expect(await visitRowOf(TODAY_JOB)).toMatchObject({ ended_at: minutesAfterStart(80).toISOString() });
  });

  it("keep the photographs to our own bucket, and send nothing to FSM", async () => {
    const sentAt = minutesAfterStart(30);
    await work(sentAt, TODAY_JOB, UP_TO_THE_OUTCOME.slice(0, 3));

    expect(await writeStatesOf(TODAY_JOB)).toEqual(["written"]);
    expect(fsmQueue.sent).toEqual([]);
  });
});

// A replacement: the old piece comes off, failed, and a new one goes on.
describe("the piece, without FSM", () => {
  const REPLACEMENT = OTHER_JOB;
  const UP_TO_THE_PIECE = [
    ["checkin", AT_THE_DOOR, 2],
    ["start", undefined, 5],
    ["photos", { phase: "before" }, 10],
    ["checklist", { done: [] }, 30],
    ["consumables", { items: [] }, 40],
  ] as const;

  beforeEach(async () => {
    await bookedWithoutFsm(REPLACEMENT, { start: TODAY_START.toISOString(), type: "replacement" });
    await env.DB.prepare("DELETE FROM appointments WHERE id = ?1").bind(TODAY_JOB).run();
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-old', 'piece-old', ?1, 'MM-STD-4417-B', 'Standard base', '2026-03-25', '2026-09-21', ?2),
              ('piece-theirs', 'piece-theirs', ?3, 'MM-STD-9999-A', 'Standard base', '2026-05-02', '2026-10-29', ?2)`,
    )
      .bind(PERSON, NOW.toISOString(), NEIGHBOUR)
      .run();
  });

  const pieces = () =>
    env.DB.prepare(
      `SELECT piece_code, person_id, fsm_id = id AS own_fsm_id, appointment_id, base, supplier_lot, fitted_at,
         replacement_due_at, failure_reason
       FROM pieces ORDER BY piece_code`,
    ).all();

  const piece = (body: object, eventId = uuidv7At(50), sentAt = minutesAfterStart(60)) =>
    postAt(sentAt, `/api/tech/jobs/${REPLACEMENT}/piece`, body, eventId);

  it("records the new piece and the old one's failure when the step lands", async () => {
    // Sent at 9 am the next day; the piece went on at 13:50 on the visit's day.
    const nextMorning = new Date("2026-09-22T03:30:00.000Z");
    await work(nextMorning, REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece(
      {
        piece_code: "MM-STD-5520-A",
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        old_piece: { piece_code: "MM-STD-4417-B", failure_reason: "Adhesive lifted at the front" },
      },
      uuidv7At(50),
      nextMorning,
    );

    expect(answer.status).toBe(202);
    expect((await pieces()).results).toEqual([
      {
        piece_code: "MM-STD-4417-B",
        person_id: PERSON,
        own_fsm_id: 1,
        appointment_id: null,
        base: "Standard base",
        supplier_lot: null,
        fitted_at: "2026-03-25",
        replacement_due_at: "2026-09-21",
        failure_reason: "Adhesive lifted at the front",
      },
      {
        piece_code: "MM-STD-5520-A",
        person_id: PERSON,
        own_fsm_id: 1,
        appointment_id: REPLACEMENT,
        base: "Standard base",
        supplier_lot: "LOT-2026-09",
        // Fitted on the 21st in India, whatever day the write arrived; due 180 days on.
        fitted_at: "2026-09-21",
        replacement_due_at: "2027-03-20",
        failure_reason: null,
      },
      expect.objectContaining({ piece_code: "MM-STD-9999-A", person_id: NEIGHBOUR }),
    ]);
    expect(fsmQueue.sent).toEqual([]);
  });

  it("records a piece that failed on the client's head, and fits nothing", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    await piece({ piece_code: "MM-STD-4417-B", failure_reason: "Torn at the crown" });

    const rows = (await pieces()).results as { piece_code: string; failure_reason: string | null }[];
    expect(rows.map((row) => [row.piece_code, row.failure_reason])).toEqual([
      ["MM-STD-4417-B", "Torn at the crown"],
      ["MM-STD-9999-A", null],
    ]);
  });

  it("records the piece once, however often the phone sends the step", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);
    const body = { piece_code: "MM-STD-5520-A", base: "Standard base" };
    const eventId = uuidv7At(50);

    await piece(body, eventId);
    const replayed = await piece(body, eventId);
    // Sent again as a new step, as a technician who opened the screen again sends it: still this visit's own piece.
    const again = await piece(body, uuidv7At(55));

    expect(await replayed.json()).toMatchObject({ replayed: true });
    expect(again.status).toBe(202);
    const fitted = await env.DB.prepare("SELECT COUNT(*) AS n FROM pieces WHERE piece_code = 'MM-STD-5520-A'").first<{
      n: number;
    }>();
    expect(fitted?.n).toBe(1);
  });

  it("refuses a label another client's piece carries, and records nothing", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({ piece_code: "MM-STD-9999-A", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
    const landed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM job_events WHERE appointment_id = ?1 AND kind = 'piece'",
    )
      .bind(REPLACEMENT)
      .first<{ n: number }>();
    expect(landed?.n).toBe(0);
    expect((await pieces()).results).toHaveLength(2);
  });

  it("refuses the client's own old piece sent as the new one", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({ piece_code: "MM-STD-4417-B", base: "Standard base" });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["piece_code"] } });
  });

  it("refuses another client's piece as the one that came off", async () => {
    await work(minutesAfterStart(60), REPLACEMENT, UP_TO_THE_PIECE);

    const answer = await piece({
      piece_code: "MM-STD-5520-A",
      old_piece: { piece_code: "MM-STD-9999-A", failure_reason: "Torn" },
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "piece_code", fields: ["old_piece"] } });
    const theirs = await env.DB.prepare("SELECT failed_at FROM pieces WHERE id = 'piece-theirs'").first();
    expect(theirs).toEqual({ failed_at: null });
  });
});

describe("dispatch, without FSM", () => {
  /** Today's job as a dispatch board loaded now shows it, which every move sends. */
  const AS_THE_BOARD_SHOWS_IT = { expected_technician_id: IMRAN, expected_starts_at: TODAY_START.toISOString() };

  it("reassigns and moves a visit in one write, records who moved it and why, and messages the client", async () => {
    await env.DB.prepare(
      `INSERT INTO consents (id, person_id, purpose, notice_version, granted, created_at)
       VALUES ('consent-visits', ?1, 'whatsapp_visits', 'whatsapp-visits-v1', 1, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      date: "2026-09-22",
      window: "morning",
      reason: "technician_unavailable",
    });

    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ client_notice: "messaged" });
    const visit = await env.DB.prepare("SELECT technician_id, window_start, window_end FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first();
    expect(visit).toEqual({
      technician_id: SAMEER,
      window_start: "2026-09-22T03:30:00.000Z",
      window_end: "2026-09-22T05:00:00.000Z",
    });
    const move = await env.DB.prepare(
      "SELECT was_technician_id, now_technician_id, reason, fsm_write_state, message_id FROM dispatch_moves",
    ).first<Record<string, string | null>>();
    expect(move).toMatchObject({
      was_technician_id: IMRAN,
      now_technician_id: SAMEER,
      reason: "technician_unavailable",
      fsm_write_state: "written",
    });
    expect(move?.message_id).not.toBeNull();
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first<{ n: number }>();
    expect(claims?.n).toBe(0);
    expect(messageQueue.sent).toHaveLength(1);
  });

  it("refuses a move that would give one technician two jobs in one window, and writes nothing", async () => {
    await bookedWithoutFsm(OTHER_JOB, { start: TODAY_START.toISOString(), technician: SAMEER });

    const answer = await opsPost("/api/dispatch/move", {
      appointment_id: TODAY_JOB,
      ...AS_THE_BOARD_SHOWS_IT,
      technician_id: SAMEER,
      reason: "zone_rebalance",
    });

    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "clash" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first()).toEqual({ n: 0 });
  });

  it("writes nothing when the visit moves under the write, and answers that the board is out of date", async () => {
    // Someone else's move of the same visit lands between this one's checks and its write.
    const db = env.DB;
    const movedMeanwhile: Pick<D1Database, "prepare" | "batch"> = {
      prepare: (sql) => db.prepare(sql),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        await db.prepare("UPDATE appointments SET technician_id = ?2 WHERE id = ?1").bind(TODAY_JOB, SAMEER).run();
        return db.batch<T>(statements);
      },
    };

    const outcome = await moveJob(
      movedMeanwhile as D1Database,
      { fsm: fsmSwitchedOff(), labelAsTest: true, record: "ours" },
      {
        appointmentId: TODAY_JOB,
        date: "2026-09-22",
        window: "morning",
        reason: "running_over",
        actor: "ops@maneman.test",
        expected: { technicianId: IMRAN, startsAt: TODAY_START.toISOString() },
      },
      NOW,
    );

    expect(outcome).toEqual({ kind: "superseded", changed: ["technician"] });
    const visit = await env.DB.prepare("SELECT technician_id, window_start FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first();
    expect(visit).toEqual({ technician_id: SAMEER, window_start: TODAY_START.toISOString() });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first()).toEqual({ n: 0 });
  });

  it("writes nothing when the technician starts the visit under a move that clears his check-in", async () => {
    await work(minutesAfterStart(2), TODAY_JOB, [["checkin", AT_THE_DOOR, 2]]);
    // His start lands between the move's checks and its write.
    const db = env.DB;
    const startedMeanwhile: Pick<D1Database, "prepare" | "batch"> = {
      prepare: (sql) => db.prepare(sql),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        await postAt(minutesAfterStart(5), `/api/tech/jobs/${TODAY_JOB}/start`, undefined, uuidv7At(5));
        return db.batch<T>(statements);
      },
    };

    const outcome = await moveJob(
      startedMeanwhile as D1Database,
      { fsm: fsmSwitchedOff(), labelAsTest: true, record: "ours" },
      {
        appointmentId: TODAY_JOB,
        date: "2026-09-22",
        window: "morning",
        reason: "client_asked",
        actor: "ops@maneman.test",
        expected: { technicianId: IMRAN, startsAt: TODAY_START.toISOString() },
        clearCheckIn: {
          surface: "ops",
          actor: { kind: "staff", id: "ops@maneman.test" },
          action: "dispatch.check_in_cleared",
          subject: { kind: "appointment", id: TODAY_JOB },
          requestId: null,
        },
      },
      NOW,
    );

    expect(outcome).toEqual({ kind: "in_progress" });
    const visit = await env.DB.prepare("SELECT window_start, status FROM appointments WHERE id = ?1")
      .bind(TODAY_JOB)
      .first();
    expect(visit).toEqual({ window_start: TODAY_START.toISOString(), status: "in_progress" });
    const cleared = await env.DB.prepare("SELECT COUNT(*) AS n FROM job_events WHERE superseded = 1").first();
    expect(cleared).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM dispatch_moves").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log").first()).toEqual({ n: 0 });
  });
});

describe("an erasure, without FSM", () => {
  let books: StubBooks;

  beforeEach(async () => {
    books = createStubBooks();
    await env.DB.prepare(
      "UPDATE people SET books_customer_id = 'stub-customer-rohit', erased_at = ?2, name = 'Erased' WHERE id = ?1",
    )
      .bind(PERSON, NOW.toISOString())
      .run();
  });

  const pass = (deps: TestDependencies, budget = createCallBudget(40)) =>
    eraseBooksCustomers(env.DB, { ...deps, log: createLogger(), budget }, NOW);

  const erasureOf = (personId: string) =>
    env.DB.prepare("SELECT books_erased_at, books_erasure_attempts FROM people WHERE id = ?1").bind(personId).first();

  it("reaches the client's Books customer, once", async () => {
    const deps = withoutFsm({ books });

    expect(await pass(deps)).toBe(1);
    expect(await pass(deps)).toBe(0);

    expect(books.made.erased).toEqual([{ customerId: "stub-customer-rohit", outcome: "deleted" }]);
    expect(await erasureOf(PERSON)).toEqual({ books_erased_at: NOW.toISOString(), books_erasure_attempts: 0 });
  });

  it("is tried again on the next pass when Books fails, and tells ops once it stops trying", async () => {
    const deps = withoutFsm({ books });
    await env.DB.prepare("UPDATE people SET books_erasure_attempts = 8 WHERE id = ?1").bind(PERSON).run();

    books.failNext("eraseCustomer", "Books said 500");
    expect(await pass(deps)).toBe(0);
    expect(await erasureOf(PERSON)).toEqual({ books_erased_at: null, books_erasure_attempts: 9 });
    expect(deps.alerts).toEqual([]);

    books.failNext("eraseCustomer", "Books said 500");
    expect(await pass(deps)).toBe(0);
    expect(deps.alerts).toEqual([expect.stringMatching(/stub-customer-rohit.*Books said 500.*by hand/)]);

    // Ten attempts, and the pass asks no more.
    expect(await pass(deps)).toBe(0);
    expect(books.made.erased).toEqual([]);
  });

  it("waits for a payment still on its way to Books, which must name the customer, for a day at most", async () => {
    await env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES ('payment-1', 'MM-2026-0842', ?1, 'pay_test42', 150000, 'INR', 'captured', ?2, ?2, ?2)`,
    )
      .bind(PERSON, NOW.toISOString())
      .run();
    const deps = withoutFsm({ books });

    expect(await pass(deps)).toBe(0);

    await env.DB.prepare("UPDATE payments SET books_payment_id = 'books-payment-1' WHERE id = 'payment-1'").run();
    expect(await pass(deps)).toBe(1);
    expect(books.made.erased).toEqual([{ customerId: "stub-customer-rohit", outcome: "deleted" }]);
  });

  it("erases a day after the erasure even when a payment never reached Books", async () => {
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 24 * 60 * 60_000).toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
           created_at, updated_at)
         VALUES ('payment-1', 'MM-2026-0842', ?1, 'pay_test42', 150000, 'INR', 'captured', ?2, ?2, ?2)`,
      ).bind(PERSON, twoDaysAgo),
      env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(PERSON, twoDaysAgo),
    ]);

    expect(await pass(withoutFsm({ books }))).toBe(1);
  });

  it("leaves a client nobody has erased, and one with no Books customer", async () => {
    await env.DB.prepare("UPDATE people SET books_customer_id = 'stub-customer-vikram' WHERE id = ?1")
      .bind(NEIGHBOUR)
      .run();
    await env.DB.prepare("UPDATE people SET books_customer_id = NULL WHERE id = ?1").bind(PERSON).run();

    expect(await pass(withoutFsm({ books }))).toBe(0);
    expect(books.made.erased).toEqual([]);
  });

  it("stops when the run's calls are spent, and the next run finishes", async () => {
    const deps = withoutFsm({ books });

    expect(await pass(deps, createCallBudget(2))).toBe(0);
    expect(books.made.erased).toEqual([]);
    expect(await pass(deps)).toBe(1);
  });

  it("is the cron's own job, which runs with FSM switched off", async () => {
    const job = CRON_JOBS.filter((each) => each.name === "books_erasures");
    const config = { ...LOCAL_CONFIG, providers: { ...LOCAL_CONFIG.providers, ...PROVIDERS_FOR.ours } };

    const outcomes = await runCronJobs(job, {
      env: { ...env, FSM_QUEUE: fsmQueue, MESSAGE_QUEUE: messageQueue },
      deps: withoutFsm({ books }),
      config,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "books_erasures", ok: true }]);
    expect(books.made.erased).toEqual([{ customerId: "stub-customer-rohit", outcome: "deleted" }]);
  });
});
