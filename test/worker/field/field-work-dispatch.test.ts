// A technician's day: each step, piece and move is written in the request that makes it. NOW is Monday 21 September
// 2026, 12 noon in India; today's job is at 13:00. Every name, number and label here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { moveJob } from "../../../src/domain/dispatch/dispatch.ts";
import { openTechnicianSession } from "../../../src/domain/dispatch/technicians.ts";
import { eraseBooksCustomers } from "../../../src/domain/books/books-erasure.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import {
  appFor,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  request,
  type TestDependencies,
} from "../helpers.ts";
import {
  PERSON,
  NEIGHBOUR,
  TODAY_JOB,
  OTHER_JOB,
  IMRAN,
  SAMEER,
  AT_THE_DOOR,
  TODAY_START,
  minutesAfterStart,
  uuidv7At,
  booked,
} from "./field-work-fixtures.ts";

let messageQueue: ReturnType<typeof fakeQueue>;

let cookie: string;

const bindings = () => ({ MESSAGE_QUEUE: messageQueue }) as unknown as Partial<Env>;

/** A write from the technician's phone that reaches the API at `at`, as a phone replaying its outbox does. */
const postAt = (at: Date, path: string, body: unknown, eventId: string) =>
  request(
    appFor("local", fakeDependencies({ now: () => at }), {}, "tech"),
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
const opsPost = (path: string, body: unknown, deps: TestDependencies = fakeDependencies()) =>
  request(
    appFor("local", deps, {}, "ops"),
    path,
    {
      method: "POST",
      headers: { Origin: "https://maneman.test", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

/** Each step, its body, and the minute after the start the phone took it, sent together at `sentAt`. */
async function work(sentAt: Date, jobId: string, steps: readonly (readonly [string, unknown, number])[]) {
  for (const [step, body, minute] of steps) {
    const answer = await postAt(sentAt, `/api/tech/jobs/${jobId}/${step}`, body, uuidv7At(minute));
    expect(answer.status, `${step} at minute ${String(minute)}`).toBeLessThan(300);
  }
}

beforeEach(async () => {
  await markDatabase();
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
  await booked(TODAY_JOB, { start: TODAY_START.toISOString() });
  cookie = `mm_tech=${await openTechnicianSession(env.DB, {
    technicianId: IMRAN,
    deviceId: "phone-abc-123",
    label: "Chrome on Android",
    now: NOW,
  })}`;
});

describe("dispatch", () => {
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
      "SELECT was_technician_id, now_technician_id, reason, fsm_write_state, write_state, message_id FROM dispatch_moves",
    ).first<Record<string, string | null>>();
    expect(move).toMatchObject({
      was_technician_id: IMRAN,
      now_technician_id: SAMEER,
      reason: "technician_unavailable",
      fsm_write_state: "written",
      write_state: "written",
    });
    expect(move?.message_id).not.toBeNull();
    const claims = await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_claims").first<{ n: number }>();
    expect(claims?.n).toBe(0);
    expect(messageQueue.sent).toHaveLength(1);
  });

  it("refuses a move that would give one technician two jobs in one window, and writes nothing", async () => {
    // Another client's job: a technician never takes two of Rohit's in a row (docs/decisions/0111).
    await booked(OTHER_JOB, { start: TODAY_START.toISOString(), technician: SAMEER, person: null });

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
      {},
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
    // Their start lands between the move's checks and its write.
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
      {},
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

describe("an erasure", () => {
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
    const deps = fakeDependencies({ books });

    expect(await pass(deps)).toBe(1);
    expect(await pass(deps)).toBe(0);

    expect(books.made.erased).toEqual([{ customerId: "stub-customer-rohit", outcome: "deleted" }]);
    expect(await erasureOf(PERSON)).toEqual({ books_erased_at: NOW.toISOString(), books_erasure_attempts: 0 });
  });

  it("is tried again on the next pass when Books fails, and tells ops once it stops trying", async () => {
    const deps = fakeDependencies({ books });
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
    const deps = fakeDependencies({ books });

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

    expect(await pass(fakeDependencies({ books }))).toBe(1);
  });

  it("leaves a client nobody has erased, and one with no Books customer", async () => {
    await env.DB.prepare("UPDATE people SET books_customer_id = 'stub-customer-vikram' WHERE id = ?1")
      .bind(NEIGHBOUR)
      .run();
    await env.DB.prepare("UPDATE people SET books_customer_id = NULL WHERE id = ?1").bind(PERSON).run();

    expect(await pass(fakeDependencies({ books }))).toBe(0);
    expect(books.made.erased).toEqual([]);
  });

  it("stops when the run's calls are spent, and the next run finishes", async () => {
    const deps = fakeDependencies({ books });

    expect(await pass(deps, createCallBudget(2))).toBe(0);
    expect(books.made.erased).toEqual([]);
    expect(await pass(deps)).toBe(1);
  });

  it("is the cron's own job", async () => {
    const job = CRON_JOBS.filter((each) => each.name === "books_erasures");

    const outcomes = await runCronJobs(job, {
      env: { ...env, MESSAGE_QUEUE: messageQueue },
      deps: fakeDependencies({ books }),
      config: LOCAL_CONFIG,
      log: createLogger(),
    });

    expect(outcomes).toEqual([{ job: "books_erasures", ok: true }]);
    expect(books.made.erased).toEqual([{ customerId: "stub-customer-rohit", outcome: "deleted" }]);
  });
});
