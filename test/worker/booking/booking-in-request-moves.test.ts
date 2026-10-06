// Booking, moving and cancelling: each is written in the request that makes it. NOW is Monday 21 September 2026, 12 noon
// in India. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { autoRefundsOf } from "../../../src/domain/money/auto-refunds.ts";
import { moveJob } from "../../../src/domain/dispatch/dispatch.ts";
import { createStubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, fakeDependencies, fakeQueue, markDatabase, NOW } from "../helpers.ts";
import { technician } from "../clients.ts";
import {
  PERSON,
  VISIT,
  PAYMENT,
  THURSDAY_NOON,
  cookies,
  messageQueue,
  useMessageQueue,
  call,
  webhook,
  payment,
  signedInClient,
  fittedClient,
  booked,
  holdRow,
  visitOf,
  visitsOf,
  messagesOf,
  changes,
} from "./booking-in-request-fixtures.ts";

/** Tuesday 22 September, morning: inside 24 hours from NOW. */
const TUESDAY_MORNING = "2026-09-22T03:30:00.000Z";

async function moveHold(date: string, window: string, type = "service") {
  const answer = await call(PERSON, "/api/holds", { method: "POST", body: { type, date, window, moving: VISIT } });
  expect(answer.status).toBe(201);
  return (await answer.json<{ id: string }>()).id;
}

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  cookies.clear();
  useMessageQueue(fakeQueue());
  await technician();
  await env.DB.prepare(
    "INSERT INTO serviceable_pincodes (pincode, area, city, served, launched_at) VALUES ('122018', 'South City II', 'Gurgaon', 1, '2026-09-01T18:30:00.000Z')",
  ).run();
});

describe("a visit moved by the client", () => {
  it("moves it in place for free, in the request that confirms the move", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");

    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    expect(await started.json()).toEqual({ hold_id: holdId, checkout: null });

    expect(await visitOf(VISIT)).toMatchObject({
      status: "scheduled",
      window_start: "2026-09-25T10:30:00.000Z",
      window_end: "2026-09-25T12:00:00.000Z",
    });
    expect(await holdRow(holdId)).toEqual({ state: "booked", appointment_id: VISIT });
    expect((await changes()).results).toEqual([
      { appointment_id: VISIT, kind: "moved", notice: "free", refund_amount: 0, kept_amount: 0, payment_id: null },
    ]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "reschedule_confirmation", subject_id: VISIT }]);
  });

  it("books a new visit for a late move once paid, and cancels and charges the old one", async () => {
    await fittedClient();
    await booked(TUESDAY_MORNING);
    const holdId = await moveHold("2026-09-26", "afternoon");
    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    expect(checkout.amount).toBe(200000);

    const ordered = { holdId, orderId: checkout.order_id, amount: checkout.amount };
    await webhook("payment.captured", "evt_move", payment("pay_new", ordered));

    const [old, replacement] = (await visitsOf(PERSON, "service")).results;
    expect(old).toEqual({ id: VISIT, status: "cancelled" });
    expect(replacement?.status).toBe("scheduled");
    expect((await changes()).results).toEqual([
      {
        appointment_id: VISIT,
        kind: "replaced",
        notice: "late",
        refund_amount: 0,
        kept_amount: 200000,
        payment_id: PAYMENT,
      },
    ]);
  });
});

describe("a client's move in place, when ops change the visit before it is booked", () => {
  const OPS = {};

  /** Ops giving the visit to Sameer on the dispatch board, at the time it has. */
  const toSameer = (startsAt: string) => ({
    appointmentId: VISIT,
    technicianId: "t2",
    reason: "zone_rebalance" as const,
    actor: "ops@maneman.test",
    expected: { technicianId: "t1", startsAt },
  });

  const confirm = (holdId: string) =>
    env.DB.prepare("UPDATE slot_holds SET confirmed_at = ?2 WHERE id = ?1").bind(holdId, NOW.toISOString()).run();

  const countOf = async (table: string) =>
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

  beforeEach(async () => {
    await technician("t2", "Sameer Bhatt", "SB");
  });

  it("gives a free move back and tells the client when ops gave the visit to another technician meanwhile", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    expect(await moveJob(env.DB, OPS, toSameer(THURSDAY_NOON), NOW)).toMatchObject({ kind: "moved" });

    await call(PERSON, `/api/appointments/${VISIT}/reschedule`, { method: "POST", body: { hold_id: holdId } });

    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t2", window_start: THURSDAY_NOON });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
    expect(messageQueue.sent).toHaveLength(1);
    expect(await countOf("slot_claims")).toBe(0);
  });

  it("refunds a late fee paid after ops gave the visit to another technician, and tells the client", async () => {
    await signedInClient(PERSON, "+919810000001", "Rohit Malhotra");
    await booked(TUESDAY_MORNING, "first_fit");
    const holdId = await moveHold("2026-09-28", "morning", "first_fit");
    const started = await call(PERSON, `/api/appointments/${VISIT}/reschedule`, {
      method: "POST",
      body: { hold_id: holdId },
    });
    const { checkout } = await started.json<{ checkout: { order_id: string; amount: number } }>();
    expect(checkout.amount).toBe(400000);
    expect(await moveJob(env.DB, OPS, toSameer(TUESDAY_MORNING), NOW)).toMatchObject({ kind: "moved" });
    const payments = createStubPayments();

    const ordered = { holdId, orderId: checkout.order_id, amount: checkout.amount };
    await webhook("payment.captured", "evt_fee", payment("pay_fee", ordered), fakeDependencies({ payments }));

    expect(payments.made.refunds).toEqual([{ paymentId: "pay_fee", amount: 400000 }]);
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t2", window_start: TUESDAY_MORNING });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await changes()).results).toEqual([]);
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
    expect(await autoRefundsOf(env.DB, PERSON)).toMatchObject([{ holdId, amount: 400000, reason: "not_movable" }]);
  });

  it("gives a free move back and tells the client when the technician is away on the new day", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    await env.DB.prepare(
      `INSERT INTO technician_leave (id, technician_id, from_date, to_date, actor, created_at)
       VALUES ('leave-1', 't1', '2026-09-25', '2026-09-25', 'ops@maneman.test', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();

    await call(PERSON, `/api/appointments/${VISIT}/reschedule`, { method: "POST", body: { hold_id: holdId } });

    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await holdRow(holdId)).toEqual({ state: "released", appointment_id: null });
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "booking_refunded", subject_id: holdId }]);
  });

  it("refuses ops' move of a visit whose client's move is confirmed and waits to be booked", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    await confirm(holdId);

    expect(await moveJob(env.DB, OPS, toSameer(THURSDAY_NOON), NOW)).toEqual({
      kind: "superseded",
      changed: ["moving"],
    });
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await countOf("dispatch_moves")).toBe(0);
  });

  it("writes nothing when the client's move is confirmed between ops' checks and their write", async () => {
    await fittedClient();
    await booked(THURSDAY_NOON);
    const holdId = await moveHold("2026-09-25", "evening");
    const claimsHeld = await countOf("slot_claims");
    const db = env.DB;
    const confirmedMeanwhile: Pick<D1Database, "prepare" | "batch"> = {
      prepare: (sql) => db.prepare(sql),
      batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
        await confirm(holdId);
        return db.batch<T>(statements);
      },
    };

    const outcome = await moveJob(confirmedMeanwhile as D1Database, OPS, toSameer(THURSDAY_NOON), NOW);

    expect(outcome).toEqual({ kind: "superseded", changed: ["moving"] });
    expect(await visitOf(VISIT)).toMatchObject({ technician_id: "t1", window_start: THURSDAY_NOON });
    expect(await countOf("dispatch_moves")).toBe(0);
    expect(await countOf("slot_claims")).toBe(claimsHeld);
  });
});
