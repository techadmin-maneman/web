// The cron's razorpay_catch_up job: a payment whose webhook never came is read from Razorpay, recorded, and its hold
// booked or refunded. NOW is Monday 21 September 2026, 12 noon in India; a hold made at NOW runs out ten minutes on,
// and its grace two minutes after. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import type { RazorpayPayment } from "../../../src/providers/payments/razorpay.ts";
import { CRON_JOBS, runCronJobs } from "../../../src/scheduled/cron.ts";
import {
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_CONFIG,
  markDatabase,
  NOW,
  type TestDependencies,
} from "../helpers.ts";
import { asClient, client, fittedInAugust, signedIn, technician } from "../clients.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
/** The client's Payments tab in the console, which each alert links to. */
const CLIENT_PAGE = `http://ops.localhost:4323/clients/${PERSON}/payments`;

const SECOND = 1000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const at = (seconds: number) => new Date(NOW.getTime() + seconds * SECOND);
/** The hold's ten minutes, its two minutes' grace, and the quarter hour the webhook is given. */
const WEBHOOK_GIVEN_UP = 12 * MINUTE + 15 * MINUTE;

let cookie = "";
let messageQueue: ReturnType<typeof fakeQueue>;
let payments: StubPayments;
/** Each order whose payments the job read from Razorpay, in turn. */
let ordersRead: string[];
/** Each payment link the job read from Razorpay, in turn. */
let linksRead: string[];

const dependencies = (seconds: number): TestDependencies =>
  fakeDependencies({
    now: () => at(seconds),
    payments: {
      ...payments,
      orderPayments: (orderId) => {
        ordersRead.push(orderId);
        return payments.orderPayments(orderId);
      },
      paymentLink: (linkId) => {
        linksRead.push(linkId);
        return payments.paymentLink(linkId);
      },
    },
  });

const job = CRON_JOBS.filter((each) => each.name === "razorpay_catch_up");

/** One run of the job, `seconds` after NOW. */
function runAt(deps: TestDependencies) {
  const bindings = { ...env, MESSAGE_QUEUE: messageQueue };
  return runCronJobs(job, { env: bindings, deps, config: LOCAL_CONFIG, log: createLogger() });
}

/** A hold for a service visit, and the Razorpay order the app opened Checkout with. */
async function heldAndOrdered() {
  const call = (path: string, body: object) =>
    asClient(cookie, path, { method: "POST", body }, { deps: fakeDependencies({ payments }) });
  const held = await call("/api/holds", { type: "service", date: "2026-09-24", window: "afternoon" });
  expect(held.status).toBe(201);
  const hold = await held.json<{ id: string }>();
  const started = await call("/api/bookings", { hold_id: hold.id });
  const checkout = (await started.json<{ checkout: { order_id: string; amount: number } }>()).checkout;
  return { holdId: hold.id, orderId: checkout.order_id, amount: checkout.amount };
}

/** Razorpay's payment entity, made `seconds` after NOW on the order, as an order's payments carry it. */
const captured = (id: string, orderId: string, seconds: number, amount = 200_000): RazorpayPayment => ({
  id,
  amount,
  currency: "INR",
  status: "captured",
  captured: true,
  order_id: orderId,
  method: "upi",
  notes: [],
  created_at: Math.floor(at(seconds).getTime() / SECOND),
});

const holdRow = (id: string) =>
  env.DB.prepare("SELECT state, appointment_id, confirmed_at FROM slot_holds WHERE id = ?1")
    .bind(id)
    .first<{ state: string; appointment_id: string | null; confirmed_at: string | null }>();

const paymentRow = (id: string) =>
  env.DB.prepare(
    "SELECT person_id, appointment_id, razorpay_order_id, status, amount, reference FROM payments WHERE razorpay_payment_id = ?1",
  )
    .bind(id)
    .first();

const messagesOf = (personId: string) =>
  env.DB.prepare("SELECT kind FROM outbound_messages WHERE person_id = ?1 ORDER BY created_at")
    .bind(personId)
    .all<{ kind: string }>();

beforeEach(async () => {
  await markDatabase();
  captureLogs();
  messageQueue = fakeQueue();
  payments = createStubPayments();
  ordersRead = [];
  linksRead = [];
  await technician();
  await client(PERSON);
  // Fitted in August, so a service visit is theirs to book.
  await fittedInAugust(PERSON);
  cookie = await signedIn(PERSON);
});

describe("a hold paid at Checkout whose webhook never came", () => {
  it("is asked about once its grace and a quarter hour more have passed, then booked, and ops are told once", async () => {
    const ordered = await heldAndOrdered();
    payments.paymentsOn.set(ordered.orderId, [captured("pay_unheard", ordered.orderId, 30)]);

    await runAt(dependencies(WEBHOOK_GIVEN_UP - MINUTE));
    expect(ordersRead).toEqual([]);

    const deps = dependencies(WEBHOOK_GIVEN_UP);
    expect(await runAt(deps)).toEqual([{ job: "razorpay_catch_up", ok: true }]);

    const hold = await holdRow(ordered.holdId);
    expect(hold?.state).toBe("booked");
    expect(await paymentRow("pay_unheard")).toEqual({
      person_id: PERSON,
      appointment_id: hold?.appointment_id,
      razorpay_order_id: ordered.orderId,
      status: "captured",
      amount: 200_000,
      reference: "MM-2026-0001",
    });
    expect((await messagesOf(PERSON)).results).toEqual([{ kind: "payment_receipt" }]);
    expect(deps.alerts).toEqual([
      `Payment pay_unheard of Rs. 2,000 for booking ${ordered.holdId} reached us only when we asked Razorpay. It is ` +
        "recorded now, and the visit is booked, or refunded if its time has gone. Razorpay's payment messages may " +
        `not be reaching us (runbook, "Razorpay's webhook is not arriving"). ${CLIENT_PAGE}`,
    ]);
  });

  it("does nothing twice: a booked hold is not asked about again, and nothing is recorded or told again", async () => {
    const ordered = await heldAndOrdered();
    payments.paymentsOn.set(ordered.orderId, [captured("pay_once", ordered.orderId, 30)]);
    const deps = dependencies(WEBHOOK_GIVEN_UP);

    await runAt(deps);
    await runAt(dependencies(WEBHOOK_GIVEN_UP + HOUR));

    expect(ordersRead).toEqual([ordered.orderId]);
    expect(deps.alerts).toHaveLength(1);
    const visits = await env.DB.prepare("SELECT id FROM appointments WHERE person_id = ?1 AND type = 'service'")
      .bind(PERSON)
      .all();
    expect(visits.results).toHaveLength(1);
    expect((await messagesOf(PERSON)).results).toHaveLength(1);
  });

  it("books a hold let go when it ran out, on its own time, where nothing has taken it since", async () => {
    const ordered = await heldAndOrdered();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM slot_claims WHERE hold_id = ?1").bind(ordered.holdId),
      env.DB.prepare("UPDATE slot_holds SET state = 'released' WHERE id = ?1").bind(ordered.holdId),
    ]);
    payments.paymentsOn.set(ordered.orderId, [captured("pay_let_go", ordered.orderId, 30)]);

    await runAt(dependencies(WEBHOOK_GIVEN_UP));

    expect((await holdRow(ordered.holdId))?.state).toBe("booked");
  });

  it("refunds, once, a payment Razorpay made after the hold and its grace ran out, and books nothing", async () => {
    const ordered = await heldAndOrdered();
    payments.paymentsOn.set(ordered.orderId, [captured("pay_late", ordered.orderId, 12 * MINUTE + 5)]);

    await runAt(dependencies(WEBHOOK_GIVEN_UP));
    await runAt(dependencies(WEBHOOK_GIVEN_UP + HOUR));

    expect(await holdRow(ordered.holdId)).toMatchObject({ state: "released", appointment_id: null });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_late", amount: 200_000 }]);
  });

  it("tells ops to book or refund by hand a payment it can neither book nor refund", async () => {
    const ordered = await heldAndOrdered();
    payments.paymentsOn.set(ordered.orderId, [captured("pay_stuck", ordered.orderId, 12 * MINUTE + 5)]);
    const deps = fakeDependencies({
      now: () => at(WEBHOOK_GIVEN_UP),
      payments: { ...payments, refund: () => Promise.reject(new Error("Razorpay 400 BAD_REQUEST_ERROR")) },
    });

    await runAt(deps);

    expect(deps.alerts).toHaveLength(2);
    expect(deps.alerts[1]).toBe(
      `Booking ${ordered.holdId} is paid for, but could not be booked or refunded: Razorpay refused the refund of ` +
        `pay_stuck. Book the visit for the client, or refund the payment in Razorpay's dashboard. ${CLIENT_PAGE}`,
    );
  });

  it("asks about a hold nothing was paid for once an hour, and not once three days have passed", async () => {
    const ordered = await heldAndOrdered();

    await runAt(dependencies(WEBHOOK_GIVEN_UP));
    await runAt(dependencies(WEBHOOK_GIVEN_UP + 15 * MINUTE));
    await runAt(dependencies(WEBHOOK_GIVEN_UP + HOUR));
    await runAt(dependencies(10 * MINUTE + 72 * HOUR + MINUTE));

    expect(ordersRead).toEqual([ordered.orderId, ordered.orderId]);
    expect((await holdRow(ordered.holdId))?.confirmed_at).toBeNull();
  });
});

describe("a hold ops sent a payment link for, paid without its webhook", () => {
  it("is recorded on the hold, which is booked, from an hour after the link was made", async () => {
    const ordered = await heldAndOrdered();
    await env.DB.prepare(
      `UPDATE slot_holds SET pay_by_link = 1, payment_link_id = 'plink_ops', razorpay_order_id = NULL, expires_at = ?2
       WHERE id = ?1`,
    )
      .bind(ordered.holdId, at(24 * HOUR).toISOString())
      .run();
    payments.linksNow.set("plink_ops", { id: "plink_ops", status: "paid", order_id: "order_ops" });
    payments.paymentsOn.set("order_ops", [captured("pay_ops", "order_ops", 30 * MINUTE)]);

    await runAt(dependencies(30 * MINUTE));
    expect((await holdRow(ordered.holdId))?.confirmed_at).toBeNull();

    const deps = dependencies(HOUR);
    await runAt(deps);

    expect((await holdRow(ordered.holdId))?.state).toBe("booked");
    expect(await paymentRow("pay_ops")).toMatchObject({ razorpay_order_id: "order_ops", status: "captured" });
    expect(deps.alerts).toHaveLength(1);
  });
});

describe("a one visit's payment link, paid without its webhook", () => {
  /** A one visit fitted at NOW, and its link, sent at once. */
  async function linkSent() {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
           synced_at, one_visit)
         VALUES (?1, ?1, ?2, 'first_fit', 'completed', '2026-09-21T03:30:00.000Z', '2026-09-21T06:30:00.000Z', 't1',
           ?3, 'booked')`,
      ).bind(VISIT, PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
           short_url, sent_at, reference_year, reference_number, reference, created_at, updated_at)
         VALUES ('link-1', ?1, 'natural', 4500000, 3813559, 18, 'plink_visit', 'https://rzp.io/i/visit', ?2, 2026, 7,
           'MM-2026-0007', ?2, ?2)`,
      ).bind(VISIT, NOW.toISOString()),
    ]);
    payments.linksNow.set("plink_visit", {
      id: "plink_visit",
      status: "paid",
      reference_id: "MM-2026-0007",
      order_id: "order_visit",
    });
    payments.paymentsOn.set("order_visit", [captured("pay_visit", "order_visit", 10 * MINUTE, 4_500_000)]);
  }

  const linkRow = () =>
    env.DB.prepare("SELECT razorpay_payment_id, paid_at FROM payment_links WHERE id = 'link-1'").first();

  it("is recorded as the visit's payment under the link's reference, the link marked paid, and ops told once", async () => {
    await linkSent();

    const deps = dependencies(HOUR);
    await runAt(deps);
    await runAt(dependencies(2 * HOUR));

    expect(await paymentRow("pay_visit")).toEqual({
      person_id: PERSON,
      appointment_id: VISIT,
      razorpay_order_id: "order_visit",
      status: "captured",
      amount: 4_500_000,
      reference: "MM-2026-0007",
    });
    expect(await linkRow()).toEqual({ razorpay_payment_id: "pay_visit", paid_at: at(10 * MINUTE).toISOString() });
    expect(ordersRead).toEqual(["order_visit"]);
    expect(deps.alerts).toEqual([
      `Payment pay_visit of Rs. 45,000 for visit ${VISIT} reached us only when we asked Razorpay. It is recorded now ` +
        `as the visit's payment. Razorpay's payment messages may not be reaching us (runbook, "Razorpay's webhook is ` +
        `not arriving"). ${CLIENT_PAGE}`,
    ]);
  });

  it("is marked paid without telling ops where only the link's own event was missed", async () => {
    await linkSent();
    await env.DB.prepare(
      `INSERT INTO payments (id, person_id, appointment_id, razorpay_order_id, razorpay_payment_id, amount, currency,
         status, captured_at, created_at, updated_at)
       VALUES ('pay-row', ?1, ?2, 'order_visit', 'pay_visit', 4500000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(PERSON, VISIT, at(10 * MINUTE).toISOString())
      .run();

    const deps = dependencies(HOUR);
    await runAt(deps);

    expect(await linkRow()).toMatchObject({ razorpay_payment_id: "pay_visit" });
    expect(deps.alerts).toEqual([]);
  });

  it("is not asked about in the hour after it was sent", async () => {
    await linkSent();

    await runAt(dependencies(HOUR - MINUTE));

    expect(await linkRow()).toEqual({ razorpay_payment_id: null, paid_at: null });
  });
});

describe("holds and links in one run", () => {
  /** A hold whose Checkout opened on `orderId` and was let go when it ran out, `expiresIn` seconds on, nothing paid. */
  const letGoHold = (id: string, orderId: string, expiresIn: number) =>
    env.DB.prepare(
      `INSERT INTO slot_holds (id, person_id, type, date, window_label, technician_id, start_unit, amount,
         amount_ex_gst, gst_percent, state, razorpay_order_id, expires_at, created_at, updated_at)
       VALUES (?1, ?2, 'service', '2026-09-24', 'afternoon', 't1', 0, 200000, 169492, 18, 'released', ?3, ?4, ?5, ?5)`,
    )
      .bind(id, PERSON, orderId, at(expiresIn).toISOString(), NOW.toISOString())
      .run();

  /** A one visit fitted at NOW, and its link, sent at once and still unpaid. */
  const unpaidLink = () =>
    env.DB.batch([
      env.DB.prepare(
        `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id,
           synced_at, one_visit)
         VALUES (?1, ?1, ?2, 'first_fit', 'completed', '2026-09-21T03:30:00.000Z', '2026-09-21T06:30:00.000Z', 't1',
           ?3, 'booked')`,
      ).bind(VISIT, PERSON, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO payment_links (id, appointment_id, tier, amount, amount_ex_gst, gst_percent, razorpay_link_id,
           short_url, sent_at, reference_year, reference_number, reference, created_at, updated_at)
         VALUES ('link-1', ?1, 'natural', 4500000, 3813559, 18, 'plink_unpaid', 'https://rzp.io/i/unpaid', ?2, 2026, 7,
           'MM-2026-0007', ?2, ?2)`,
      ).bind(VISIT, NOW.toISOString()),
    ]);

  it("take turns, so holds that would spend every call of the run still leave some for a link", async () => {
    await letGoHold("hold-a", "order_a", 10 * MINUTE);
    await letGoHold("hold-b", "order_b", 11 * MINUTE);
    await unpaidLink();
    payments.linksNow.set("plink_unpaid", { id: "plink_unpaid", status: "created", order_id: null });

    await runAt(dependencies(HOUR));
    expect(ordersRead).toEqual(["order_a"]);
    expect(linksRead).toEqual(["plink_unpaid"]);

    await runAt(dependencies(HOUR + 15 * MINUTE));
    expect(ordersRead).toEqual(["order_a", "order_b"]);
    expect(linksRead).toEqual(["plink_unpaid"]);
  });
});
