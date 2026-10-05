// A day's money, on the ops surface (src/routes/ops/payments.ts), Ops Console
// D1. NOW is Monday 21 September 2026, 12 noon in India, and a day runs from
// midnight to midnight there. Nothing here is a real person or number, and no
// amount is anything but paise.
//
// No total is kept anywhere: the figures are read from the payments, the
// refunds and the visit changes themselves, so the tests write those rows and
// read the day back.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/http/context.ts";
import { appFor, captureLogs, fakeDependencies, markDatabase, NOW, request } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const OTHER = "11111111-1111-4111-8111-111111111112";
const VISIT = "22222222-2222-4222-8222-222222222221";
const PAYMENT = "33333333-3333-4333-8333-333333333331";
const CHANGE = "44444444-4444-4444-8444-444444444441";
const CASE = "55555555-5555-4555-8555-555555555551";
const CHECK_IN = "66666666-6666-4666-8666-666666666661";
const TECHNICIAN = "77777777-7777-4777-8777-777777777771";

/** India's 21 September 2026 runs from 18:30 UTC on the 20th to 18:30 UTC on the 21st. */
const MORNING = "2026-09-21T04:00:00.000Z";
const YESTERDAY = "2026-09-20T04:00:00.000Z";

let ops: App;

interface Charge {
  id: string;
  kind: string;
  person: { id: string; name: string } | null;
  amount: number | null;
  at: string;
  visit_started_at: string | null;
  change: string | null;
  technician: string | null;
}

interface Body {
  date: string;
  collected: number;
  refunds_processing: number;
  refunded: number;
  charged: number;
  charges: Charge[];
}

const day = async (query = ""): Promise<Body> => (await request(ops, `/api/payments${query}`)).json<Body>();

async function person(id: string, name: string, mobile: string) {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, '2026-08-01T06:00:00.000Z', ?2, ?3)",
  )
    .bind(id, mobile, name)
    .run();
}

let payments = 0;

/** A payment as the Razorpay mirror holds it; `capturedAt` null for one that never was. */
async function payment(options: { id: string; amount: number; capturedAt: string | null; status?: string }) {
  await env.DB.prepare(
    `INSERT INTO payments (id, person_id, appointment_id, razorpay_payment_id, amount, currency, status,
       captured_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'INR', ?6, ?7, ?8, ?8)`,
  )
    .bind(
      options.id,
      PERSON,
      VISIT,
      `pay_${String(++payments)}`,
      options.amount,
      options.status ?? (options.capturedAt === null ? "failed" : "captured"),
      options.capturedAt,
      options.capturedAt ?? MORNING,
    )
    .run();
}

async function refund(options: { amount: number; status: string; createdAt: string; processedAt: string | null }) {
  await env.DB.prepare(
    `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, created_at, processed_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?6)`,
  )
    .bind(
      crypto.randomUUID(),
      PAYMENT,
      `rfnd_${crypto.randomUUID()}`,
      options.amount,
      options.status,
      options.createdAt,
      options.processedAt,
    )
    .run();
}

/** A visit the client ended, with what was kept and what went back (migration 0020). */
async function visitChange(options: {
  id?: string;
  personId?: string;
  kind: string;
  notice: string;
  kept: number;
  at: string;
}) {
  await env.DB.prepare(
    `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
       created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, '2026-09-21T04:30:00.000Z', 0, ?6, ?7)`,
  )
    .bind(
      options.id ?? CHANGE,
      VISIT,
      options.personId ?? PERSON,
      options.kind,
      options.notice,
      options.kept,
      options.at,
    )
    .run();
}

async function appointment() {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, 'fsm-t1', 'Imran Qureshi', 'IQ', 1, ?2)",
  )
    .bind(TECHNICIAN, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       technician_id, fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-1', ?2, 'service', 'completed', 'Completed', '2026-09-21T04:30:00.000Z',
       '2026-09-21T07:30:00.000Z', ?3, ?4, ?4)`,
  )
    .bind(VISIT, PERSON, TECHNICIAN, NOW.toISOString())
    .run();
}

/** A job closed as a no-show and ruled on by ops; a charge keeps what it records, or, before charges were priced, nothing recorded. */
async function noShow(decision: string, decidedAt: string | null, kept: number | null = null) {
  await env.DB.prepare(
    `INSERT INTO checkins (id, appointment_id, technician_id, at, lat, lng, distance_m, radius_m, passed, created_at)
     VALUES (?1, ?2, ?3, '2026-09-21T04:31:00.000Z', 28.4, 77.0, 240, 200, 1, '2026-09-21T04:31:00.000Z')`,
  )
    .bind(CHECK_IN, VISIT, TECHNICIAN)
    .run();
  await env.DB.prepare(
    `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
       decision, decided_at, created_at, charge, kept_amount)
     VALUES (?1, ?2, ?3, '2026-09-21T04:31:00.000Z', '2026-09-21T04:46:00.000Z', '2026-09-21T04:47:00.000Z',
       ?4, ?5, '2026-09-21T04:47:00.000Z', ?6, ?7)`,
  )
    .bind(CASE, CHECK_IN, VISIT, decision, decidedAt, kept === null ? null : "visit", kept)
    .run();
}

beforeEach(async () => {
  captureLogs();
  payments = 0;
  ops = appFor("local", fakeDependencies(), {}, "ops");
  await markDatabase();
  await person(PERSON, "Rohit Malhotra", "+919810000001");
  await person(OTHER, "Vikram Sethi", "+919810000002");
  await appointment();
});

describe("GET /api/payments", () => {
  it("reads today in India when no date is asked for", async () => {
    expect(await day()).toMatchObject({ date: "2026-09-21" });
  });

  it("totals what was captured on the day, and nothing captured on another", async () => {
    await payment({ id: PAYMENT, amount: 200000, capturedAt: MORNING });
    await payment({ id: "33333333-3333-4333-8333-333333333332", amount: 300000, capturedAt: YESTERDAY });
    expect(await day()).toMatchObject({ collected: 200000 });
    expect(await day("?date=2026-09-20")).toMatchObject({ collected: 300000 });
  });

  it("leaves out an attempt that was never captured, which is not money", async () => {
    await payment({ id: PAYMENT, amount: 200000, capturedAt: null });
    expect(await day()).toMatchObject({ collected: 0 });
  });

  it("counts a refund on the day Razorpay processed it, and one still on its way separately", async () => {
    await payment({ id: PAYMENT, amount: 500000, capturedAt: YESTERDAY });
    await refund({ amount: 200000, status: "processed", createdAt: YESTERDAY, processedAt: MORNING });
    await refund({ amount: 150000, status: "created", createdAt: MORNING, processedAt: null });
    // A refund Razorpay gave up on is neither back with the client nor on its way.
    await refund({ amount: 90000, status: "failed", createdAt: MORNING, processedAt: null });

    expect(await day()).toMatchObject({ refunded: 200000, refunds_processing: 150000 });
    expect(await day("?date=2026-09-20")).toMatchObject({ refunded: 0, refunds_processing: 0 });
  });

  it("totals what was kept from clients on the day", async () => {
    await visitChange({ kind: "cancelled", notice: "late", kept: 236000, at: MORNING });
    expect(await day()).toMatchObject({ charged: 236000 });
  });

  // The board prices a no-show like a late cancellation, and the charge now records what it kept
  // (docs/decisions/0096-a-no-shows-charge-and-its-dispute.md), where before it was counted beside the figure.
  it("adds what a charged no-show kept to the figure", async () => {
    await visitChange({ kind: "cancelled", notice: "late", kept: 236000, at: MORNING });
    await noShow("charged", MORNING, 200000);
    expect(await day()).toMatchObject({ charged: 436000 });
  });

  it("gives a nought on a day nothing happened, which is true and not a guess", async () => {
    expect(await day("?date=2026-09-19")).toMatchObject({
      collected: 0,
      refunded: 0,
      refunds_processing: 0,
      charged: 0,
      charges: [],
    });
  });

  it("lists a late cancellation with its client, what was kept, and the evidence for it", async () => {
    await visitChange({ kind: "cancelled", notice: "late", kept: 200000, at: MORNING });
    expect((await day()).charges).toEqual([
      {
        id: CHANGE,
        kind: "late_cancellation",
        person: { id: PERSON, name: "Rohit Malhotra" },
        amount: 200000,
        at: MORNING,
        visit_started_at: "2026-09-21T04:30:00.000Z",
        change: "cancelled",
        technician: null,
      },
    ]);
  });

  it("reads a visit replaced inside the day as a cancellation, because the client ended it", async () => {
    await visitChange({ kind: "replaced", notice: "late", kept: 200000, at: MORNING });
    expect((await day()).charges).toMatchObject([{ change: "cancelled" }]);
  });

  it("leaves out a change that cost the client nothing", async () => {
    await visitChange({ kind: "cancelled", notice: "free", kept: 0, at: MORNING });
    expect((await day()).charges).toEqual([]);
  });

  it("lists a no-show ops charged, with the client, what it kept and the technician who attended", async () => {
    await noShow("charged", MORNING, 200000);
    expect((await day()).charges).toMatchObject([
      {
        id: CASE,
        kind: "no_show",
        person: { id: PERSON, name: "Rohit Malhotra" },
        amount: 200000,
        at: MORNING,
        visit_started_at: "2026-09-21T04:30:00.000Z",
        change: null,
        technician: "Imran Qureshi",
      },
    ]);
  });

  // A no-show charged before a charge recorded what it kept: answering the visit's payment here would guess.
  it("carries no amount on a no-show charged before its charge was recorded, and adds none", async () => {
    await noShow("charged", MORNING);
    expect(await day()).toMatchObject({ charged: 0, charges: [{ kind: "no_show", amount: null }] });
  });

  // As a change that cost the client nothing is left out, so is a charge that kept no money: a credit it spent is
  // in the client's credits, not the day's money.
  it("leaves out a no-show whose charge kept no money", async () => {
    await noShow("charged", MORNING, 0);
    expect((await day()).charges).toEqual([]);
  });

  it("leaves out a no-show that was waived, and one nobody has ruled on", async () => {
    await noShow("waived", MORNING);
    expect((await day()).charges).toEqual([]);

    await env.DB.prepare("UPDATE no_show_cases SET decision = 'undecided', decided_at = NULL").run();
    expect((await day()).charges).toEqual([]);
  });

  it("puts both kinds of charge in one list, the earliest first", async () => {
    await noShow("charged", "2026-09-21T05:00:00.000Z", 200000);
    await visitChange({ kind: "cancelled", notice: "late", kept: 200000, at: MORNING });
    expect((await day()).charges.map((each) => each.kind)).toEqual(["late_cancellation", "no_show"]);
  });

  // What was taken on a day stays what was taken; only the named line goes.
  it("leaves an erased client's line out, and leaves the day's own figures where they are", async () => {
    await payment({ id: PAYMENT, amount: 200000, capturedAt: MORNING });
    await visitChange({ kind: "cancelled", notice: "late", kept: 200000, at: MORNING });
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();

    expect(await day()).toMatchObject({ collected: 200000, charged: 200000, charges: [] });
  });

  it("refuses a date that is not one", async () => {
    expect((await request(ops, "/api/payments?date=yesterday")).status).toBe(400);
  });

  it("belongs to the ops surface alone", async () => {
    const client = appFor("local", fakeDependencies(), {}, "client");
    // The client app has a payments route of its own, on its own surface, and it asks for a session.
    expect((await request(client, "/api/payments")).status).toBe(401);
    const publicSurface = appFor("local", fakeDependencies(), {}, "public");
    expect((await request(publicSurface, "/api/payments")).status).toBe(404);
  });
});
