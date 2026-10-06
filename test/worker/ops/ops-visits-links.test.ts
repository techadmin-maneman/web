// Booking a visit from the console (src/routes/ops/visits.ts): every kind, for a client ops are talking to. A paid
// visit holds its slot while a Razorpay payment link is open and is booked once the link is paid; a free one, one a
// credit pays for, and a consultation and fit in one visit are booked at once. NOW is Monday 21 September 2026,
// 12 noon in India, so the first bookable day is Tuesday the 22nd. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { startBooking } from "../../../src/domain/booking/bookings.ts";
import { holdSlot } from "../../../src/domain/booking/hold-slot.ts";
import { outstandingTasks } from "../../../src/domain/ops/tasks.ts";
import { TASK_SLA_HOURS } from "../../../src/policy/tasks.ts";
import { type PaymentsProvider } from "../../../src/providers/payments/index.ts";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { ProviderError } from "../../../src/providers/provider-error.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  deliverRazorpay,
} from "../helpers.ts";
import {
  IMRAN,
  SANDEEP,
  ROHIT,
  NATURAL,
  SERVICE_PRICE,
  WEDNESDAY,
  bindings,
  technician,
  rohit,
  makeCode,
  holdOf,
  holdsCount,
} from "./ops-visits-fixtures.ts";

/** The first reference of NOW's year, which the first link ops send takes before any payment. */
const FIRST_REFERENCE = "MM-2026-0001";

let payments: StubPayments;

/** What a test may change about the console: its payments and staging's handsets. */
interface Vendors {
  readonly payments?: PaymentsProvider;
  readonly allowlist?: string[];
}

const opsApp = (vendors: Vendors = {}) => {
  const deps = fakeDependencies({ payments: vendors.payments ?? payments });
  const allowlist = vendors.allowlist ?? LOCAL_SETTINGS.messaging.allowlist;
  const settings = { messaging: { ...LOCAL_SETTINGS.messaging, allowlist } };
  return appFor("local", deps, settings, "ops");
};

const book = (body: object, vendors: Vendors = {}) =>
  request(
    opsApp(vendors),
    "/api/visits",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    bindings(),
  );

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  payments = createStubPayments();
  await technician(IMRAN, "Imran Qureshi", "IQ");
  await technician(SANDEEP, "Sandeep Rawat", "SR");
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
       VALUES ('first_fit', ?1, ?2, 180, 1, 'ops@localhost', ?3)`,
    ).bind(NATURAL.tier, NATURAL.name, NOW.toISOString()),
    env.DB.prepare(
      `INSERT INTO price_book (item, tier, amount_ex_gst, gst_percent, valid_from)
       VALUES ('first_fit', ?1, ?2, 0, '2026-09-01')`,
    ).bind(NATURAL.tier, NATURAL.amount),
  ]);
});

describe("POST /api/visits: a paid visit goes out as a payment link", () => {
  it("holds the slot and sends a link for the visit's price that closes with the hold; nothing is booked yet", async () => {
    await rohit("consulted");
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: "2026-09-25",
      window: "morning",
    });
    expect(answer.status).toBe(201);
    const body = await answer.json<
      { hold_id: string; link: { url: string; open_until: string } } & Record<string, unknown>
    >();
    expect(body).toMatchObject({
      outcome: "awaiting_payment",
      pays: "link",
      visit_id: null,
      price: { amount: NATURAL.amount },
      service: { tier: NATURAL.tier, name: NATURAL.name },
      link: { open_until: "2026-09-22T06:30:00.000Z" },
    });
    // The client reads a reference on Razorpay's page that their receipt repeats, not the hold's ID.
    expect(payments.made.links).toEqual([
      {
        amount: NATURAL.amount,
        reference: FIRST_REFERENCE,
        description: "Mane Man Natural · Fri 25 Sep, morning",
        customer: { name: "Rohit Malhotra", contact: "+919810000001" },
        notes: { hold_id: body.hold_id, person_id: ROHIT },
        closesAt: new Date("2026-09-22T06:30:00.000Z"),
        notify: true,
      },
    ]);
    const hold = await holdOf(body.hold_id);
    expect(hold).toMatchObject({
      state: "held",
      confirmed_at: null,
      pay_by_link: 1,
      payment_link_url: body.link.url,
      reference: FIRST_REFERENCE,
      razorpay_order_id: null,
      expires_at: "2026-09-22T06:30:00.000Z",
    });
    expect(hold?.payment_link_id).toMatch(/^plink_stub_/);
    expect(payments.made.orders).toEqual([]);
  });

  // Staging texted every link, whoever the number belonged to.
  it("makes the link but has Razorpay text it only to a number on staging's allowlist", async () => {
    await rohit("fitted");
    const logs = captureLogs();
    const visit = { client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" };
    expect((await book(visit, { allowlist: ["+919810000777"] })).status).toBe(201);
    expect(payments.made.links).toMatchObject([{ notify: false }]);
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "payment_link_not_texted" }));
  });

  it("takes a discount code off a paid service visit's link before GST", async () => {
    await rohit("fitted");
    await makeCode();
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening", code: "TENPC" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string }>();
    expect(payments.made.links[0]?.amount).toBe(SERVICE_PRICE * 0.9);
    const use = await env.DB.prepare("SELECT amount_off FROM discount_code_uses WHERE hold_id = ?1")
      .bind(body.hold_id)
      .first();
    expect(use).toEqual({ amount_off: SERVICE_PRICE * 0.1 });
  });

  it("refuses a code that does not apply, and holds nothing", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening", code: "NOPE1" });
    expect(answer.status).toBe(422);
    expect(await answer.json()).toMatchObject({ error: { code: "code_not_applicable" } });
    expect(await holdsCount()).toBe(0);
  });

  it("lets the slot go, and says so, when Razorpay cannot make the link", async () => {
    await rohit("fitted");
    const down: PaymentsProvider = {
      ...createStubPayments(),
      createPaymentLink: () => Promise.reject(new ProviderError(503, "SERVER_ERROR", "down")),
      findPaymentLink: () => Promise.resolve(null),
    };
    const answer = await book(
      { client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" },
      { payments: down },
    );
    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await holdsCount()).toBe(0);
  });

  it("keeps the link Razorpay made under the hold's reference though its answer never came", async () => {
    await rohit("fitted");
    const lookedFor: string[] = [];
    const lost: PaymentsProvider = {
      ...createStubPayments(),
      createPaymentLink: () =>
        Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "reference_id already exists")),
      findPaymentLink: (reference) => {
        lookedFor.push(reference);
        return Promise.resolve({ id: "plink_made", shortUrl: "https://rzp.io/i/made" });
      },
    };
    const answer = await book(
      { client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" },
      { payments: lost },
    );
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string; link: object }>();
    expect(body.link).toMatchObject({ url: "https://rzp.io/i/made" });
    expect(lookedFor).toEqual([FIRST_REFERENCE]);
    expect(await holdOf(body.hold_id)).toMatchObject({ payment_link_id: "plink_made" });
  });

  it("is paid by its link alone: the client's own Checkout cannot start paying for it", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    expect(await startBooking({ db: env.DB, payments: payments, now: NOW }, holdId, ROHIT)).toBeNull();
    expect(payments.made.orders).toEqual([]);
    expect(await holdOf(holdId)).toMatchObject({ state: "held", razorpay_order_id: null });
  });

  it("is never let go when the client makes a hold of their own in the app meanwhile", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    const price = { amount: SERVICE_PRICE, amount_ex_gst: SERVICE_PRICE, gst_percent: 0 };
    const own = await holdSlot({
      db: env.DB,
      input: {
        personId: ROHIT,
        service: { type: "service", tier: "standard", minutes: 90 },
        date: "2026-09-24",
        window: "morning",
        price,
      },
      now: NOW,
      holdSeconds: 600,
    });
    expect(own).not.toBeNull();
    expect((await holdOf(holdId))?.state).toBe("held");
  });
});

describe("a payment link for a visit ops booked, paid", () => {
  const deliver = (event: object, eventId: string) =>
    deliverRazorpay(event, { eventId, deps: fakeDependencies({ payments }), bindings: bindings() });

  /** A link ops sent: the hold it waits on, Razorpay's ID for it, and its reference. */
  interface SentLink {
    readonly holdId: string;
    readonly linkId: string;
    readonly reference: string;
  }

  function linkPaid(sent: SentLink, paidAt: Date, amount = SERVICE_PRICE) {
    const link = { id: sent.linkId, reference_id: sent.reference };
    return {
      entity: "event",
      event: "payment_link.paid",
      contains: ["payment_link", "order", "payment"],
      payload: {
        payment_link: { entity: { ...link, status: "paid", amount, amount_paid: amount } },
        payment: {
          entity: {
            id: "pay_link_1",
            entity: "payment",
            amount,
            currency: "INR",
            status: "captured",
            order_id: "order_link_1",
            method: "upi",
            contact: "+919810000001",
            notes: { hold_id: sent.holdId, person_id: ROHIT },
            created_at: Math.floor(paidAt.getTime() / 1000),
          },
        },
      },
    };
  }

  async function sentLink(): Promise<SentLink> {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    const hold = await holdOf(holdId);
    return { holdId, linkId: hold?.payment_link_id ?? "", reference: hold?.reference ?? "" };
  }

  it("records the payment on the hold, and confirms it from Razorpay's time", async () => {
    const sent = await sentLink();
    const { holdId } = sent;
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    expect((await deliver(linkPaid(sent, paidAt), "evt-1")).status).toBe(200);

    const payment = await env.DB.prepare(
      `SELECT person_id, razorpay_order_id, amount_ex_gst, status, reference
       FROM payments WHERE razorpay_payment_id = 'pay_link_1'`,
    ).first();
    expect(payment).toEqual({
      person_id: ROHIT,
      razorpay_order_id: "order_link_1",
      amount_ex_gst: SERVICE_PRICE,
      status: "captured",
      // What the client read on Razorpay's page is what their receipt says.
      reference: FIRST_REFERENCE,
    });
    expect(await holdOf(holdId)).toMatchObject({
      razorpay_order_id: "order_link_1",
      confirmed_at: paidAt.toISOString(),
    });
    expect(payments.made.refunds).toEqual([]);
  });

  it("refunds a link paid after its hold had lapsed and let the slot go", async () => {
    const sent = await sentLink();
    const { holdId } = sent;
    const lapsed = new Date("2026-09-22T08:00:00.000Z");
    await env.DB.prepare("UPDATE slot_holds SET state = 'released' WHERE id = ?1").bind(holdId).run();
    await deliver(linkPaid(sent, lapsed), "evt-2");

    expect(await holdOf(holdId)).toMatchObject({ state: "released" });
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_link_1", amount: SERVICE_PRICE }]);
  });

  it("takes a replacement due off the Tasks board once its link is paid and the visit is booked", async () => {
    await rohit("fitted");
    await env.DB.prepare(
      `INSERT INTO pieces (id, fsm_id, person_id, piece_code, base, supplier_lot, fitted_at, replacement_due_at, synced_at)
       VALUES ('piece-1', 'piece-1', ?1, 'MM-STD-4417-C', 'Mono', 'L-2704', '2026-03-01', '2026-09-01', ?2)`,
    )
      .bind(ROHIT, NOW.toISOString())
      .run();
    const groups = async () => (await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS)).tasks.map((task) => task.group);
    expect(await groups()).toContain("replacement_order");

    const answer = await book({ client: ROHIT, kind: "replacement", date: WEDNESDAY, window: "morning" });
    const { hold_id: holdId, price } = await answer.json<{ hold_id: string; price: { amount: number } }>();
    expect(await groups()).toContain("replacement_order");

    const hold = await holdOf(holdId);
    const sent = { holdId, linkId: hold?.payment_link_id ?? "", reference: hold?.reference ?? "" };
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    await deliver(linkPaid(sent, paidAt, price.amount), "evt-4");
    expect(await groups()).not.toContain("replacement_order");
  });

  it("books the visit in the webhook's own request", async () => {
    const sent = await sentLink();
    const { holdId } = sent;
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    await deliver(linkPaid(sent, paidAt), "evt-3");

    const booked = await env.DB.prepare(
      `SELECT a.status, a.type, p.razorpay_payment_id FROM slot_holds h JOIN appointments a ON a.id = h.appointment_id
       JOIN payments p ON p.appointment_id = a.id WHERE h.id = ?1 AND h.state = 'booked'`,
    )
      .bind(holdId)
      .first();
    expect(booked).toEqual({ status: "scheduled", type: "service", razorpay_payment_id: "pay_link_1" });
  });

  // Razorpay sends payment.captured for a link's payment too, often before payment_link.paid.
  it("books once and refunds nothing when the payment's capture arrives before the link's paid event", async () => {
    const sent = await sentLink();
    const { holdId } = sent;
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    const paid = linkPaid(sent, paidAt);
    const captured = { entity: "event", event: "payment.captured", payload: { payment: paid.payload.payment } };

    expect((await deliver(captured, "evt-5")).status).toBe(200);
    expect(await holdOf(holdId)).toMatchObject({ state: "held", confirmed_at: null });

    expect((await deliver(paid, "evt-6")).status).toBe(200);
    const visits = await env.DB.prepare(
      `SELECT a.id FROM slot_holds h JOIN appointments a ON a.id = h.appointment_id
       JOIN payments p ON p.appointment_id = a.id WHERE h.id = ?1 AND h.state = 'booked'`,
    )
      .bind(holdId)
      .all();
    expect(visits.results).toHaveLength(1);
    const service = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM appointments WHERE person_id = ?1 AND type = 'service'",
    )
      .bind(ROHIT)
      .first<{ n: number }>();
    expect(service?.n).toBe(1);
    expect(payments.made.refunds).toEqual([]);
    const payment = await env.DB.prepare(
      "SELECT reference FROM payments WHERE razorpay_payment_id = 'pay_link_1'",
    ).first<{ reference: string }>();
    expect(payment?.reference).toBe(FIRST_REFERENCE);
  });

  it("finds the hold by the link's reference where Razorpay's answer with the link never came", async () => {
    const sent = await sentLink();
    await env.DB.prepare("UPDATE slot_holds SET payment_link_id = NULL WHERE id = ?1").bind(sent.holdId).run();
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    await deliver(linkPaid({ ...sent, linkId: "plink_unseen" }, paidAt), "evt-7");

    expect(await holdOf(sent.holdId)).toMatchObject({ confirmed_at: paidAt.toISOString() });
  });
});
