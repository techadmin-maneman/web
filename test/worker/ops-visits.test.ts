// Booking a visit from the console (src/routes/ops-visits.ts): every kind, for a client ops are talking to. A paid
// visit holds its slot while a Razorpay payment link is open and is booked once the link is paid; a free one, one a
// credit pays for, and a consultation and fit in one visit are booked at once. NOW is Monday 21 September 2026,
// 12 noon in India, so the first bookable day is Tuesday the 22nd. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { startBooking } from "../../src/domain/bookings.ts";
import { creditBalance, grantCredits } from "../../src/domain/credits.ts";
import { makeCodes, type NewCodes } from "../../src/domain/discount-codes.ts";
import { holdSlot } from "../../src/domain/scheduling.ts";
import { outstandingTasks } from "../../src/domain/tasks.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { TASK_SLA_HOURS } from "../../src/policy/tasks.ts";
import { createStubPayments, type PaymentsProvider, type StubPayments } from "../../src/providers/payments.ts";
import { ProviderError } from "../../src/providers/provider-error.ts";
import {
  appFor,
  captureLogs,
  fakeDependencies,
  fakeQueue,
  LOCAL_SETTINGS,
  markDatabase,
  NOW,
  request,
  savedAddress,
} from "./helpers.ts";

const IMRAN = "t1";
const SANDEEP = "t2";
const ROHIT = "11111111-1111-4111-8111-111111111111";
const NATURAL = { tier: "natural", name: "Mane Man Natural", amount: 4_500_000 };
const SERVICE_PRICE = 200_000;
const WEDNESDAY = "2026-09-23";
/** The first reference of NOW's year, which the first link ops send takes before any payment. */
const FIRST_REFERENCE = "MM-2026-0001";

let payments: StubPayments;

/** The queue a booking's messages go on, kept rather than delivered. */
const bindings = () => ({ MESSAGE_QUEUE: fakeQueue() });

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

async function technician(id: string, name: string, initials: string) {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
  )
    .bind(id, id, name, initials, NOW.toISOString())
    .run();
}

async function visit(personId: string | null, type: string, status: string, startsAt: string, technicianId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, technician_id, synced_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`,
  )
    .bind(id, personId, type, status, startsAt, technicianId, NOW.toISOString())
    .run();
  return id;
}

/** Rohit, with his address saved: new to us, consulted, or fitted. */
async function rohit(stage: "new" | "consulted" | "fitted" = "new") {
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(ROHIT, NOW.toISOString())
    .run();
  await savedAddress(ROHIT, "122018");
  if (stage === "consulted") await visit(ROHIT, "consultation", "completed", "2026-09-01T06:30:00.000Z", IMRAN);
  if (stage === "fitted") await visit(ROHIT, "first_fit", "completed", "2026-08-01T03:30:00.000Z", IMRAN);
}

/** Ten per cent off service visits and first fits. */
const TEN_OFF: NewCodes = {
  code: "TENPC",
  count: 1,
  kind: "percent",
  value: 10,
  cap: null,
  covers: ["first_fit", "service"],
  expiresOn: null,
  maxUses: null,
  oncePerClient: true,
};

const makeCode = () =>
  makeCodes(env.DB, TEN_OFF, { actor: { kind: "staff", id: "ops@localhost" }, requestId: "r", now: NOW });

interface HoldRow {
  state: string;
  type: string;
  tier: string;
  technician_id: string;
  amount: number;
  confirmed_at: string | null;
  use_credit: number;
  one_visit: number;
  pay_by_link: number;
  payment_link_id: string | null;
  payment_link_url: string | null;
  reference: string | null;
  razorpay_order_id: string | null;
  expires_at: string;
  no_show_charge: string | null;
}

const holdOf = (id: string) =>
  env.DB.prepare(
    `SELECT state, type, tier, technician_id, amount, confirmed_at, use_credit, one_visit, pay_by_link, payment_link_id,
       payment_link_url, reference, razorpay_order_id, expires_at, no_show_charge
     FROM slot_holds WHERE id = ?1`,
  )
    .bind(id)
    .first<HoldRow>();

const holdsCount = async () =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM slot_holds WHERE state = 'held'").first<{ n: number }>())?.n;

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

describe("POST /api/visits: what is booked at once", () => {
  it("books a free consultation at once, and audits it", async () => {
    await rohit();
    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({
      outcome: "booked",
      pays: "nothing",
      visit_id: expect.any(String) as string,
      link: null,
      date: WEDNESDAY,
      window: "morning",
      service: { tier: "standard", name: "Consultation", minutes: 60 },
      price: { amount: 0 },
    });
    const hold = await holdOf(body.hold_id);
    expect(hold).toMatchObject({ state: "booked", type: "consultation", pay_by_link: 0 });
    expect(hold?.confirmed_at).toBe(NOW.toISOString());

    const audit = await env.DB.prepare("SELECT subject_id, detail FROM audit_log WHERE action = 'visit.book'").first<{
      subject_id: string;
      detail: string;
    }>();
    expect(audit?.subject_id).toBe(ROHIT);
    expect(JSON.parse(audit?.detail ?? "{}")).toEqual({
      hold_id: body.hold_id,
      kind: "consultation",
      tier: "standard",
      date: WEDNESDAY,
      window: "morning",
      pays: "nothing",
    });
  });

  it("books with the technician ops chose, and refuses him in a window he is busy in", async () => {
    await rohit("fitted");
    const chosen = await book({
      client: ROHIT,
      kind: "service",
      date: WEDNESDAY,
      window: "morning",
      technician: SANDEEP,
    });
    const body = await chosen.json<{ hold_id: string; technician: object }>();
    expect(body.technician).toEqual({ id: SANDEEP, name: "Sandeep Rawat" });
    expect((await holdOf(body.hold_id))?.technician_id).toBe(SANDEEP);

    await visit(null, "service", "scheduled", "2026-09-23T06:30:00.000Z", IMRAN); // Wednesday, 12 noon
    const busy = await book({
      client: ROHIT,
      kind: "service",
      date: WEDNESDAY,
      window: "afternoon",
      technician: IMRAN,
    });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "taken" } });
  });

  it("refuses a window nobody is free in, and holds nothing", async () => {
    await rohit();
    await visit(null, "service", "scheduled", "2026-09-23T03:30:00.000Z", IMRAN);
    await visit(null, "service", "scheduled", "2026-09-23T03:30:00.000Z", SANDEEP);
    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "taken" } });
    expect(await holdsCount()).toBe(0);
  });

  it("books a consultation and fit in one visit with nothing paid, under its own terms, the code waiting for the link", async () => {
    await rohit();
    await makeCode();
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "morning",
      code: "tenpc",
    });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({ outcome: "booked", pays: "nothing", price: { amount: 0 } });
    expect(await holdOf(body.hold_id)).toMatchObject({
      one_visit: 1,
      amount: 0,
      no_show_charge: "nothing",
      tier: NATURAL.tier,
    });
    const use = await env.DB.prepare("SELECT amount_off FROM discount_code_uses WHERE hold_id = ?1")
      .bind(body.hold_id)
      .first();
    expect(use).toEqual({ amount_off: null });
  });

  it("refuses a one visit in the evening, or one that is not a first fit", async () => {
    await rohit();
    const evening = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "evening",
    });
    expect(evening.status).toBe(400);
    expect(await evening.json()).toMatchObject({ error: { code: "invalid_request", fields: ["window"] } });
    const service = await book({ client: ROHIT, kind: "service", one_visit: true, date: WEDNESDAY, window: "morning" });
    expect(service.status).toBe(400);
    expect(await service.json()).toMatchObject({ error: { code: "invalid_request", fields: ["one_visit"] } });
  });

  it("books a fitted client's service visit on a credit at once", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 1, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({ outcome: "booked", pays: "credit", link: null });
    expect(await holdOf(body.hold_id)).toMatchObject({ use_credit: 1, confirmed_at: NOW.toISOString() });
    expect(payments.made.links).toEqual([]);
  });
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
    // MON-30: the client reads a reference on Razorpay's page that their receipt repeats, not the hold's ID.
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

  // MON-45, PS-46: staging texted every link, whoever the number belonged to.
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
    expect(await startBooking(env.DB, payments, holdId, ROHIT, NOW)).toBeNull();
    expect(payments.made.orders).toEqual([]);
    expect(await holdOf(holdId)).toMatchObject({ state: "held", razorpay_order_id: null });
  });

  it("is never let go when the client makes a hold of their own in the app meanwhile", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    const price = { amount: SERVICE_PRICE, amount_ex_gst: SERVICE_PRICE, gst_percent: 0 };
    const own = await holdSlot(
      env.DB,
      {
        personId: ROHIT,
        service: { type: "service", tier: "standard", minutes: 90 },
        date: "2026-09-24",
        window: "morning",
        price,
      },
      NOW,
      600,
    );
    expect(own).not.toBeNull();
    expect((await holdOf(holdId))?.state).toBe("held");
  });
});

describe("POST /api/visits: what is refused", () => {
  it("refuses a second first fit while one is still to come", async () => {
    await rohit("consulted");
    await visit(ROHIT, "first_fit", "scheduled", "2026-09-28T03:30:00.000Z", IMRAN);
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: WEDNESDAY,
      window: "morning",
    });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_booked" } });
  });

  it("refuses a second first fit while the link for the first is still open, and sends no second link", async () => {
    await rohit("consulted");
    const first = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: WEDNESDAY,
      window: "morning",
    });
    expect(await first.json()).toMatchObject({ outcome: "awaiting_payment" });
    const second = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: "2026-09-25",
      window: "morning",
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "already_booked" } });
    expect(payments.made.links).toHaveLength(1);
    expect(await holdsCount()).toBe(1);
  });

  it("books a first fit again once the first link has closed unpaid", async () => {
    await rohit("consulted");
    await book({ client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: WEDNESDAY, window: "morning" });
    await env.DB.prepare("UPDATE slot_holds SET expires_at = ?1, grace_seconds = 0").bind(NOW.toISOString()).run();
    const again = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      date: "2026-09-25",
      window: "morning",
    });
    expect(again.status).toBe(201);
  });

  it("refuses a client it does not have, and one who has been erased", async () => {
    const unknown = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(unknown.status).toBe(404);
    await rohit();
    await env.DB.prepare("UPDATE people SET erased_at = ?2 WHERE id = ?1").bind(ROHIT, NOW.toISOString()).run();
    const erased = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(erased.status).toBe(404);
  });

  it("refuses a first fit on a day the console offers no hair system, and a day that cannot be booked", async () => {
    await rohit("consulted");
    await env.DB.prepare("UPDATE services SET retired_date = '2026-01-01' WHERE kind = 'first_fit'").run();
    const noProduct = await book({ client: ROHIT, kind: "first_fit", date: WEDNESDAY, window: "morning" });
    expect(noProduct.status).toBe(422);
    expect(await noProduct.json()).toMatchObject({ error: { code: "no_product" } });

    const today = await book({ client: ROHIT, kind: "service", date: "2026-09-21", window: "evening" });
    expect(today.status).toBe(422);
    expect(await today.json()).toMatchObject({ error: { code: "not_bookable" } });
  });
});

describe("a payment link for a visit ops booked, paid", () => {
  const SECRET = "a-razorpay-webhook-secret-for-tests";

  async function deliver(event: object, eventId: string) {
    const body = JSON.stringify(event);
    const settings = { razorpay: { keyId: "rzp_test_abc", keySecret: "key-secret", webhookSecret: SECRET } };
    const app = appFor("local", fakeDependencies({ payments }), { ...LOCAL_SETTINGS, ...settings }, "public");
    return request(
      app,
      "/api/hooks/razorpay",
      {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Razorpay-Signature": await saltedHash(SECRET, body),
          "X-Razorpay-Event-Id": eventId,
        },
      },
      bindings(),
    );
  }

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

describe("POST /api/visits: the visit written in the request", () => {
  it("writes a free consultation in the request, with the window the client asked for, and its task goes", async () => {
    await rohit();
    await env.DB.prepare(
      `INSERT INTO consultation_requests (id, person_id, pincode, requested_date, requested_window, created_at)
       VALUES ('request-1', ?1, '122018', ?2, 'afternoon', ?3)`,
    )
      .bind(ROHIT, WEDNESDAY, NOW.toISOString())
      .run();
    const waiting = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(waiting.tasks.map((task) => task.group)).toContain("consultation_request");

    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ visit_id: string; outcome: string }>();
    expect(body.outcome).toBe("booked");
    const booked = await env.DB.prepare(
      "SELECT status, type, asked_window, asked_checked_at FROM appointments WHERE id = ?1",
    )
      .bind(body.visit_id)
      .first();
    expect(booked).toEqual({
      status: "scheduled",
      type: "consultation",
      asked_window: "afternoon",
      asked_checked_at: NOW.toISOString(),
    });
    const after = await outstandingTasks(env.DB, NOW, TASK_SLA_HOURS);
    expect(after.tasks.map((task) => task.group)).not.toContain("consultation_request");
  });

  it("writes a consultation and fit in one visit in the request, marked as one", async () => {
    await rohit();
    const answer = await book({
      client: ROHIT,
      kind: "first_fit",
      tier: NATURAL.tier,
      one_visit: true,
      date: WEDNESDAY,
      window: "morning",
    });
    const body = await answer.json<{ visit_id: string; outcome: string }>();
    expect(body.outcome).toBe("booked");
    const booked = await env.DB.prepare("SELECT type, tier, one_visit FROM appointments WHERE id = ?1")
      .bind(body.visit_id)
      .first();
    expect(booked).toEqual({ type: "first_fit", tier: NATURAL.tier, one_visit: "booked" });
  });

  it("writes a service visit on a credit in the request, the credit spent on it", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 1, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const body = await answer.json<{ visit_id: string; outcome: string; pays: string }>();
    expect(body).toMatchObject({ outcome: "booked", pays: "credit" });
    expect((await creditBalance(env.DB, ROHIT, NOW)).visits).toBe(0);
  });

  it("books nothing for a paid visit until its link is paid", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const body = await answer.json<{ hold_id: string; outcome: string }>();
    expect(body.outcome).toBe("awaiting_payment");
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS n FROM appointments WHERE person_id = ?1 AND status = 'scheduled'")
        .bind(ROHIT)
        .first(),
    ).toEqual({ n: 0 });
  });
});

describe("GET /api/visits/availability", () => {
  const look = (query: string) => request(opsApp(), `/api/visits/availability?${query}`);

  it("offers each window's free technicians, the regular one first, with the kind's services and how it is paid", async () => {
    await rohit("fitted");
    await visit(null, "service", "scheduled", "2026-09-22T03:30:00.000Z", IMRAN); // Tuesday, 9 am
    const answer = await look(`client=${ROHIT}&kind=service`);
    expect(answer.status).toBe(200);
    const body = await answer.json<{
      services: object[];
      pays: string;
      days: { date: string; windows: { window: string; technicians: { id: string }[] }[] }[];
    }>();
    expect(body.services).toEqual([
      {
        tier: "standard",
        name: "Service visit",
        minutes: 90,
        price: { amount_ex_gst: SERVICE_PRICE, amount: SERVICE_PRICE, gst_percent: 0 },
      },
    ]);
    expect(body.pays).toBe("link");
    expect(body.days).toHaveLength(14);
    expect(body.days[0]?.date).toBe("2026-09-22");
    const tuesday = body.days[0]?.windows.map((each) => [each.window, each.technicians.map((one) => one.id)]);
    expect(tuesday).toEqual([
      ["morning", [SANDEEP]],
      ["afternoon", [IMRAN, SANDEEP]],
      ["evening", [IMRAN, SANDEEP]],
    ]);
  });

  it("offers a first fit as the hair systems the console sells, and a credit as how a service visit is paid", async () => {
    await rohit("fitted");
    await grantCredits(env.DB, { personId: ROHIT, visits: 2, source: "ops", sourceId: "goodwill", now: NOW }).run();
    const service = await (await look(`client=${ROHIT}&kind=service`)).json<{ pays: string; credits: number }>();
    expect(service).toMatchObject({ pays: "credit", credits: 2 });
    const fit = await (await look(`client=${ROHIT}&kind=first_fit`)).json<{ services: { tier: string }[] }>();
    expect(fit.services.map((each) => each.tier)).toContain(NATURAL.tier);
  });
});
