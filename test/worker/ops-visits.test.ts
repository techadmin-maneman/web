// Booking a visit from the console (src/routes/ops-visits.ts): every kind, for a client ops are talking to. A paid
// visit holds its slot while a Razorpay payment link is open and is booked once the link is paid; a free one, one a
// credit pays for, and a consultation and fit in one visit are booked at once. NOW is Monday 21 September 2026,
// 12 noon in India, so the first bookable day is Tuesday the 22nd. Every name, number and price is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmBooking } from "../../src/domain/bookings.ts";
import { grantCredits } from "../../src/domain/credits.ts";
import { makeCodes, type NewCodes } from "../../src/domain/discount-codes.ts";
import { holdSlot } from "../../src/domain/scheduling.ts";
import { saltedHash } from "../../src/lib/hash.ts";
import { createStubFsm, EMPTY_FSM } from "../../src/providers/fsm.ts";
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

/** FSM's catalogue, with the service visit's item, for the bookings FSM's path writes there. */
const fsm = () =>
  createStubFsm({ ...EMPTY_FSM, items: [{ id: "item-service", name: "Service visit", type: "Service", price: null }] });

let payments: StubPayments;
let queue: ReturnType<typeof fakeQueue>;

const opsApp = (vendors: { payments?: PaymentsProvider; now?: Date } = {}) =>
  appFor(
    "local",
    fakeDependencies({ payments: vendors.payments ?? payments, now: () => vendors.now ?? NOW }),
    {},
    "ops",
  );

const book = (body: object, vendors: { payments?: PaymentsProvider } = {}) =>
  request(
    opsApp(vendors),
    "/api/visits",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://maneman.test" },
      body: JSON.stringify(body),
    },
    { FSM_QUEUE: queue },
  );

async function technician(id: string, name: string, initials: string) {
  await env.DB.prepare(
    "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
  )
    .bind(id, `fsm-${id}`, name, initials, NOW.toISOString())
    .run();
}

async function visit(personId: string | null, type: string, status: string, startsAt: string, technicianId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end, technician_id,
       fsm_modified_at, synced_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6, ?7, ?8, ?8)`,
  )
    .bind(id, `fsm-${id}`, personId, type, status, startsAt, technicianId, NOW.toISOString())
    .run();
  return id;
}

/** Rohit, with his address saved: new to us, consulted, or fitted. */
async function rohit(stage: "new" | "consulted" | "fitted" = "new") {
  await env.DB.prepare("INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')")
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
  razorpay_order_id: string | null;
  expires_at: string;
  no_show_charge: string | null;
}

const holdOf = (id: string) =>
  env.DB.prepare(
    `SELECT state, type, tier, technician_id, amount, confirmed_at, use_credit, one_visit, pay_by_link, payment_link_id,
       payment_link_url, razorpay_order_id, expires_at, no_show_charge
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
  queue = fakeQueue();
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
  it("books a free consultation at once: the hold confirmed and on its way to be booked, and audited", async () => {
    await rohit();
    const answer = await book({ client: ROHIT, kind: "consultation", date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string } & Record<string, unknown>>();
    expect(body).toMatchObject({
      outcome: "being_booked",
      pays: "nothing",
      visit_id: null,
      link: null,
      date: WEDNESDAY,
      window: "morning",
      service: { tier: "standard", name: "Consultation", minutes: 60 },
      price: { amount: 0 },
    });
    const hold = await holdOf(body.hold_id);
    expect(hold).toMatchObject({ state: "held", type: "consultation", pay_by_link: 0 });
    expect(hold?.confirmed_at).toBe(NOW.toISOString());
    expect(queue.sent).toEqual([{ hold_id: body.hold_id, request_id: expect.any(String) as string }]);

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
    const chosen = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "morning", technician: SANDEEP });
    const body = await chosen.json<{ hold_id: string; technician: object }>();
    expect(body.technician).toEqual({ id: SANDEEP, name: "Sandeep Rawat" });
    expect((await holdOf(body.hold_id))?.technician_id).toBe(SANDEEP);

    await visit(null, "service", "scheduled", "2026-09-23T06:30:00.000Z", IMRAN); // Wednesday, 12 noon
    const busy = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "afternoon", technician: IMRAN });
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
    expect(body).toMatchObject({ outcome: "being_booked", pays: "nothing", price: { amount: 0 } });
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
    const evening = await book({ client: ROHIT, kind: "first_fit", tier: NATURAL.tier, one_visit: true, date: WEDNESDAY, window: "evening" });
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
    expect(body).toMatchObject({ outcome: "being_booked", pays: "credit", link: null });
    expect(await holdOf(body.hold_id)).toMatchObject({ use_credit: 1, confirmed_at: NOW.toISOString() });
    expect(payments.made.links).toEqual([]);
  });
});

describe("POST /api/visits: a paid visit goes out as a payment link", () => {
  it("holds the slot and sends a link for the visit's price that closes with the hold; nothing is booked yet", async () => {
    await rohit("consulted");
    const answer = await book({ client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: "2026-09-25", window: "morning" });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string; link: { url: string; open_until: string } } & Record<string, unknown>>();
    expect(body).toMatchObject({
      outcome: "awaiting_payment",
      pays: "link",
      visit_id: null,
      price: { amount: NATURAL.amount },
      service: { tier: NATURAL.tier, name: NATURAL.name },
      link: { open_until: "2026-09-22T06:30:00.000Z" },
    });
    expect(payments.made.links).toEqual([
      {
        amount: NATURAL.amount,
        reference: body.hold_id,
        description: "Mane Man Natural, Fri 25 Sep, morning",
        customer: { name: "Rohit Malhotra", contact: "+919810000001" },
        notes: { hold_id: body.hold_id, person_id: ROHIT },
        closesAt: new Date("2026-09-22T06:30:00.000Z"),
      },
    ]);
    const hold = await holdOf(body.hold_id);
    expect(hold).toMatchObject({
      state: "held",
      confirmed_at: null,
      pay_by_link: 1,
      payment_link_url: body.link.url,
      razorpay_order_id: null,
      expires_at: "2026-09-22T06:30:00.000Z",
    });
    expect(hold?.payment_link_id).toMatch(/^plink_stub_/);
    expect(queue.sent).toEqual([]);
    expect(payments.made.orders).toEqual([]);
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
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" }, { payments: down });
    expect(answer.status).toBe(503);
    expect(await answer.json()).toMatchObject({ error: { code: "unavailable" } });
    expect(await holdsCount()).toBe(0);
  });

  it("keeps the link Razorpay made under the hold though its answer never came", async () => {
    await rohit("fitted");
    const lost: PaymentsProvider = {
      ...createStubPayments(),
      createPaymentLink: () => Promise.reject(new ProviderError(400, "BAD_REQUEST_ERROR", "reference_id already exists")),
      findPaymentLink: () => Promise.resolve({ id: "plink_made", shortUrl: "https://rzp.io/i/made" }),
    };
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" }, { payments: lost });
    expect(answer.status).toBe(201);
    const body = await answer.json<{ hold_id: string; link: object }>();
    expect(body.link).toMatchObject({ url: "https://rzp.io/i/made" });
    expect(await holdOf(body.hold_id)).toMatchObject({ payment_link_id: "plink_made" });
  });

  it("is never let go when the client makes a hold of their own in the app meanwhile", async () => {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    const price = { amount: SERVICE_PRICE, amount_ex_gst: SERVICE_PRICE, gst_percent: 0 };
    const own = await holdSlot(
      env.DB,
      { personId: ROHIT, service: { type: "service", tier: "standard", minutes: 90 }, date: "2026-09-24", window: "morning", price },
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
    const answer = await book({ client: ROHIT, kind: "first_fit", tier: NATURAL.tier, date: WEDNESDAY, window: "morning" });
    expect(answer.status).toBe(409);
    expect(await answer.json()).toMatchObject({ error: { code: "already_booked" } });
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
    const app = appFor("local", fakeDependencies(), { ...LOCAL_SETTINGS, ...settings });
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
      { FSM_QUEUE: queue },
    );
  }

  function linkPaid(link: { id: string; reference_id: string }, paidAt: Date, amount = SERVICE_PRICE) {
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
            notes: { hold_id: link.reference_id, person_id: ROHIT },
            created_at: Math.floor(paidAt.getTime() / 1000),
          },
        },
      },
    };
  }

  async function sentLink(): Promise<{ holdId: string; linkId: string }> {
    await rohit("fitted");
    const answer = await book({ client: ROHIT, kind: "service", date: WEDNESDAY, window: "evening" });
    const { hold_id: holdId } = await answer.json<{ hold_id: string }>();
    return { holdId, linkId: (await holdOf(holdId))?.payment_link_id ?? "" };
  }

  it("records the payment on the hold, confirms it from Razorpay's time, and sends it to be booked", async () => {
    const { holdId, linkId } = await sentLink();
    const paidAt = new Date(NOW.getTime() + 60 * 60_000);
    expect((await deliver(linkPaid({ id: linkId, reference_id: holdId }, paidAt), "evt-1")).status).toBe(200);

    const payment = await env.DB.prepare(
      "SELECT person_id, razorpay_order_id, amount_ex_gst, status FROM payments WHERE razorpay_payment_id = 'pay_link_1'",
    ).first();
    expect(payment).toEqual({ person_id: ROHIT, razorpay_order_id: "order_link_1", amount_ex_gst: SERVICE_PRICE, status: "captured" });
    expect(await holdOf(holdId)).toMatchObject({ razorpay_order_id: "order_link_1", confirmed_at: paidAt.toISOString() });
    expect(queue.sent).toContainEqual({ hold_id: holdId, request_id: expect.any(String) as string });

    const booked = await confirmBooking(env.DB, fsm(), payments, holdId, paidAt, { labelAsTest: false });
    expect(booked).toBe("booked");
    expect(payments.made.refunds).toEqual([]);
  });

  it("refunds a link paid after its hold had lapsed and let the slot go", async () => {
    const { holdId, linkId } = await sentLink();
    const lapsed = new Date("2026-09-22T08:00:00.000Z");
    await env.DB.prepare("UPDATE slot_holds SET state = 'released' WHERE id = ?1").bind(holdId).run();
    await deliver(linkPaid({ id: linkId, reference_id: holdId }, lapsed), "evt-2");

    const given = await confirmBooking(env.DB, fsm(), payments, holdId, lapsed, { labelAsTest: false });
    expect(given).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_link_1", amount: SERVICE_PRICE }]);
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
      { tier: "standard", name: "Service visit", minutes: 90, price: { amount_ex_gst: SERVICE_PRICE, amount: SERVICE_PRICE, gst_percent: 0 } },
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
