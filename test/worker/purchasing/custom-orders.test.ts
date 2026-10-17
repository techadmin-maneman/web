// Custom orders (src/routes/ops/custom-orders.ts, src/domain/purchasing/custom-orders.ts,
// src/domain/money/custom-order-links.ts, src/domain/purchasing/custom-order-po.ts; docs/decisions/0174-custom-orders.md).
// NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a custom order is raised to the client's profile and its whole price asked by a payment link; once
// Razorpay says it is paid, the payment is the client's, the order paid, and a purchase order of its own drafted to
// its supplier with the stock code made to its spec, however often Razorpay says so; one not yet paid may be
// cancelled, its link with it; and a profile missing part of the spec, or a retired supplier, is refused.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { catchUpWithRazorpay } from "../../../src/domain/money/razorpay-catch-up.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { asClient, signedIn } from "../clients.ts";
import { A_NUMBER, captureLogs, deliverRazorpay, markDatabase, NOW, request } from "../helpers.ts";
import { IMRAN, JOB, PERSON, working, type Working } from "../job-fixtures.ts";

interface Orders {
  orders: { id: string; number: number; status: string; short_url: string | null; po_number: number | null }[];
  suppliers: { id: string; name: string }[];
  profile_ready: boolean;
}

let job: Working;
let payments: StubPayments;
let supplier: string;

const orders = async () => (await request(job.ops, `/api/clients/${PERSON}/custom-orders`)).json<Orders>();
const codeOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;

const raise = (over: Record<string, unknown> = {}) =>
  job.opsPost(`/api/clients/${PERSON}/custom-orders`, {
    supplier_id: supplier,
    supplier_price: 15_000,
    amount: 4_500_000,
    promised_on: "2026-10-20",
    wave: "slight_wave",
    note: null,
    ...over,
  });

/** Razorpay's word that the order's link was paid. */
function linkPaid(link: { id: string; reference_id: string }) {
  return {
    entity: "event",
    event: "payment_link.paid",
    contains: ["payment_link", "order", "payment"],
    payload: {
      payment_link: { entity: { ...link, status: "paid", amount: 4_500_000, amount_paid: 4_500_000 } },
      payment: {
        entity: {
          id: "pay_custom_1",
          entity: "payment",
          amount: 4_500_000,
          currency: "INR",
          status: "captured",
          order_id: "order_custom_1",
          method: "upi",
          contact: "+919810000001",
          notes: [],
          created_at: 1790067435,
        },
      },
    },
  };
}

beforeEach(async () => {
  captureLogs();
  await markDatabase();
  payments = createStubPayments();
  job = await working("first_fit", { payments });
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  const added = await job.opsPost("/api/suppliers", {
    name: "Lumina Hair Co",
    gstin: null,
    country: "CN",
    currency: "USD",
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 30,
    warranty_days: 90,
  });
  supplier = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
  await env.DB.prepare(
    `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
       grey_percent, density_percent)
     VALUES ('hp-1', ?1, 'ops@localhost', ?2, 'essential', 7.5, 9, '1B', 30, 120)`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
});

describe("a custom order", () => {
  it("is raised to the client's profile, and its whole price asked by a link texted to them", async () => {
    expect((await orders()).profile_ready).toBe(true);
    const raised = await raise();
    expect(raised.status).toBe(200);
    const [order] = (await raised.json<Orders>()).orders;
    expect(order).toMatchObject({ number: A_NUMBER, status: "awaiting_payment" });
    expect(order?.short_url).toMatch(/^https:\/\/rzp\.io\//);
    expect(payments.made.links).toEqual([
      expect.objectContaining({
        amount: 4_500_000,
        reference: order?.id,
        notes: { custom_order_id: order?.id, person_id: PERSON },
      }),
    ]);
  });

  it("once paid, is the client's payment and a purchase order of its own, however often Razorpay says so", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const link = {
      id: (await env.DB.prepare("SELECT razorpay_link_id FROM custom_orders").first<string>("razorpay_link_id")) ?? "",
      reference_id: order?.id ?? "",
    };
    for (const eventId of ["evt_custom_1", "evt_custom_2"]) {
      const delivered = await deliverRazorpay(linkPaid(link), { eventId, deps: job.deps });
      expect(delivered.status).toBe(200);
    }

    expect((await orders()).orders[0]).toMatchObject({ status: "paid", po_number: A_NUMBER });
    const payment = await env.DB.prepare("SELECT person_id, amount, status FROM payments").all();
    expect(payment.results).toEqual([{ person_id: PERSON, amount: 4_500_000, status: "captured" }]);
    const lines = await env.DB.prepare(
      `SELECT o.state, o.currency, o.expected_on, l.quantity, l.unit_price, l.custom_order_id, h.density_percent
       FROM purchase_orders o JOIN po_lines l ON l.po_id = o.id JOIN hair_systems h ON h.code = l.consumable_code`,
    ).all();
    expect(lines.results).toEqual([
      {
        state: "drafted",
        currency: "USD",
        expected_on: "2026-10-20",
        quantity: 1,
        unit_price: 15_000,
        custom_order_id: order?.id,
        density_percent: 120,
      },
    ]);
  });

  it("not yet paid, is cancelled with its link; a profile missing part of the spec, or a retired supplier, is refused", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const cancelled = await job.opsPost(`/api/custom-orders/${order?.id ?? ""}/cancel`);
    expect((await cancelled.json<Orders>()).orders[0]?.status).toBe("cancelled");
    expect(payments.made.cancelledLinks).toHaveLength(1);
    expect((await job.opsPost(`/api/custom-orders/${order?.id ?? ""}/cancel`)).status).toBe(409);

    await job.opsPost(`/api/suppliers/${supplier}/retire`);
    expect((await codeOf(await raise())).fields).toEqual(["supplier_id"]);
    await env.DB.prepare(
      `INSERT INTO hair_profiles (id, person_id, staff, created_at, product)
       VALUES ('hp-2', ?1, 'ops@localhost', ?2, 'essential')`,
    )
      .bind(PERSON, new Date(NOW.getTime() + 1000).toISOString())
      .run();
    expect((await codeOf(await raise())).fields).toEqual(["profile"]);
    // Said before the form, so nobody fills it in to be refused.
    expect((await orders()).profile_ready).toBe(false);
  });
});

describe("a custom order's money, wherever it goes", () => {
  const linkOf = async (orderId: string) => ({
    id: (await env.DB.prepare("SELECT razorpay_link_id FROM custom_orders").first<string>("razorpay_link_id")) ?? "",
    reference_id: orderId,
  });
  const alertKeys = async () =>
    (
      await env.DB.prepare("SELECT key FROM alerts WHERE resolved_at IS NULL ORDER BY key").all<{ key: string }>()
    ).results.map((row) => row.key);

  it("whose link could not be made, stops asking ops to send it once it is cancelled", async () => {
    const make = payments.createPaymentLink.bind(payments);
    Object.assign(payments, { createPaymentLink: () => Promise.reject(new Error("amount exceeds maximum")) });
    const [order] = (await (await raise()).json<Orders>()).orders;
    const id = order?.id ?? "";
    expect(await alertKeys()).toContain(`custom_order_link:${id}`);

    Object.assign(payments, { createPaymentLink: make });
    await job.opsPost(`/api/custom-orders/${id}/cancel`);
    expect(await alertKeys()).not.toContain(`custom_order_link:${id}`);
  });

  it("paid on its link after it was cancelled, is ops' to give back, and orders nothing", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const id = order?.id ?? "";
    await job.opsPost(`/api/custom-orders/${id}/cancel`);
    expect((await deliverRazorpay(linkPaid(await linkOf(id)), { deps: job.deps })).status).toBe(200);

    expect((await orders()).orders[0]?.status).toBe("cancelled");
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM purchase_orders").first<number>("n")).toBe(0);
    expect(await alertKeys()).toContain("custom_order_payment_stranded:pay_custom_1");
  });

  it("is never stranded by cancelling its purchase order alone", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    await deliverRazorpay(linkPaid(await linkOf(order?.id ?? "")), { deps: job.deps });
    const po = (await env.DB.prepare("SELECT id FROM purchase_orders").first<string>("id")) ?? "";
    const cancelled = await job.opsPost(`/api/purchase-orders/${po}/cancel`, { reason: "Supplier closed" });
    expect(cancelled.status).toBe(409);
    expect((await codeOf(cancelled)).code).toBe("custom_order");
    expect(await env.DB.prepare("SELECT state FROM purchase_orders").first<string>("state")).toBe("drafted");
  });

  it("paid while Razorpay's word never came, is found by the hourly catch-up and its order drafted", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const link = await linkOf(order?.id ?? "");
    const payment = linkPaid(link).payload.payment.entity;
    payments.linksNow.set(link.id, {
      id: link.id,
      status: "paid",
      reference_id: link.reference_id,
      order_id: "order_custom_1",
    });
    payments.paymentsOn.set("order_custom_1", [payment]);
    const told: string[] = [];
    const deps = {
      payments,
      alertOnce: (alert: { message: string }) => {
        told.push(alert.message);
        return Promise.resolve();
      },
      log: createLogger(),
      hashSalt: "salt",
      book: () => Promise.resolve(),
    };
    const found = await catchUpWithRazorpay(
      env.DB,
      deps,
      createCallBudget(10),
      new Date(NOW.getTime() + 2 * 3_600_000),
    );
    expect(found).toBe(1);
    expect((await orders()).orders[0]).toMatchObject({ status: "paid", po_number: A_NUMBER });
    expect(told).toHaveLength(1);
  });
});

describe("a custom order's piece", () => {
  const OTHER = "66666666-6666-4666-8666-666666666661";

  it("arrives reserved to its client: out of free stock, and never offered at another client's fit", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810066661', 'Asha Verma')",
      ).bind(OTHER, NOW.toISOString()),
      env.DB.prepare(
        `INSERT INTO hair_profiles (id, person_id, staff, created_at, product, base_width_in, base_length_in, colour,
           grey_percent, density_percent)
         VALUES ('hp-other', ?1, 'ops@localhost', ?2, 'essential', 7.5, 9, '1B', 30, 120)`,
      ).bind(OTHER, NOW.toISOString()),
    ]);
    const raised = await job.opsPost(`/api/clients/${OTHER}/custom-orders`, {
      supplier_id: supplier,
      supplier_price: 15_000,
      amount: 4_500_000,
      promised_on: null,
      wave: null,
      note: null,
    });
    const order = (await raised.json<Orders>()).orders[0]?.id ?? "";
    const linkId =
      (await env.DB.prepare("SELECT razorpay_link_id FROM custom_orders WHERE id = ?1")
        .bind(order)
        .first<string>("razorpay_link_id")) ?? "";
    await deliverRazorpay(linkPaid({ id: linkId, reference_id: order }), { deps: job.deps });
    const po = await env.DB.prepare(
      "SELECT o.id, l.id AS line, l.consumable_code AS code FROM purchase_orders o JOIN po_lines l ON l.po_id = o.id",
    ).first<{ id: string; line: string; code: string }>();
    await env.DB.prepare("UPDATE purchase_orders SET state = 'sent' WHERE id = ?1")
      .bind(po?.id ?? "")
      .run();
    const received = await job.opsPost(`/api/purchase-orders/${po?.id ?? ""}/receipts`, {
      lines: [{ po_line_id: po?.line ?? "", received: 1, damaged: 0, qc_failed: 0, lot_code: null, expires_on: null }],
      supplier_invoice: null,
      rupee_rate: 8325,
      freight_paise: 0,
      duty_paise: 0,
      clearing_paise: 0,
      note: null,
    });
    expect(received.status).toBe(200);
    const unit = await env.DB.prepare("SELECT code, custom_order_id FROM stock_units").first<{
      code: string;
      custom_order_id: string;
    }>();
    expect(unit?.custom_order_id).toBe(order);
    expect(
      (await (await request(job.ops, `/api/clients/${OTHER}/custom-orders`)).json<Orders>()).orders[0]?.status,
    ).toBe("arrived");

    const matched = await (await request(job.ops, `/api/clients/${OTHER}/stock-match`)).json<{ held: unknown[] }>();
    expect(matched.held).toEqual([]);
    await job.opsPost("/api/stock/transfers", {
      consumable_code: po?.code ?? "",
      quantity: 1,
      from: "central",
      to: IMRAN,
    });
    const card = await (
      await job.get(`/api/tech/jobs/${JOB}`)
    ).json<{
      kit_hair_systems: { code: string; held: number; units: { code: string }[] }[];
    }>();
    const listed = card.kit_hair_systems.find((each) => each.code === po?.code);
    expect(listed?.units.map((each) => each.code) ?? []).not.toContain(unit?.code);
    expect(listed?.held ?? 0).toBe(0);
  });
});

describe("a paid custom order's refund", () => {
  /** A custom order raised and paid; its purchase order drafted. */
  async function paidOrder(): Promise<string> {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const linkId =
      (await env.DB.prepare("SELECT razorpay_link_id FROM custom_orders").first<string>("razorpay_link_id")) ?? "";
    await deliverRazorpay(linkPaid({ id: linkId, reference_id: order?.id ?? "" }), { deps: job.deps });
    return order?.id ?? "";
  }
  const refund = (id: string, reason: string) => job.opsPost(`/api/custom-orders/${id}/refund`, { reason });

  it("is whole before its order goes out, and cancels the draft with it, once", async () => {
    const id = await paidOrder();
    const refunded = await refund(id, "not_ordered");
    expect((await refunded.json<Orders>()).orders[0]?.status).toBe("refunded");
    expect(payments.made.refunds).toEqual([{ paymentId: "pay_custom_1", amount: 4_500_000 }]);
    expect(await env.DB.prepare("SELECT state FROM purchase_orders").first<string>("state")).toBe("cancelled");
    expect([(await refund(id, "not_ordered")).status, payments.made.refunds.length]).toEqual([409, 1]);
    // Claimed before Razorpay was asked, so a press whose answer is lost asks again as for one that may be made.
    expect(await env.DB.prepare("SELECT refund_asked_at FROM custom_orders").first<string>("refund_asked_at")).toBe(
      NOW.toISOString(),
    );
  });

  it("is due once the order has gone only when the supplier is late past the grace, or the piece failed its check", async () => {
    const id = await paidOrder();
    const po = await env.DB.prepare(
      "SELECT o.id, l.id AS line FROM purchase_orders o JOIN po_lines l ON l.po_id = o.id",
    ).first<{ id: string; line: string }>();
    await env.DB.prepare("UPDATE purchase_orders SET state = 'sent' WHERE id = ?1")
      .bind(po?.id ?? "")
      .run();
    const refused = await refund(id, "not_ordered");
    expect([refused.status, (await codeOf(refused)).code]).toEqual([409, "refund_not_due"]);
    expect((await refund(id, "late")).status).toBe(409);

    await env.DB.prepare("UPDATE custom_orders SET promised_on = '2026-09-10' WHERE id = ?1").bind(id).run();
    expect((await refund(id, "late")).status).toBe(200);
    expect(payments.made.refunds).toHaveLength(1);
  });

  it("is due when its piece failed its check on arrival", async () => {
    const id = await paidOrder();
    const po = await env.DB.prepare(
      "SELECT o.id, l.id AS line FROM purchase_orders o JOIN po_lines l ON l.po_id = o.id",
    ).first<{ id: string; line: string }>();
    await env.DB.prepare("UPDATE purchase_orders SET state = 'sent' WHERE id = ?1")
      .bind(po?.id ?? "")
      .run();
    expect((await refund(id, "failed_check")).status).toBe(409);
    await job.opsPost(`/api/purchase-orders/${po?.id ?? ""}/receipts`, {
      lines: [{ po_line_id: po?.line ?? "", received: 0, damaged: 0, qc_failed: 1, lot_code: null, expires_on: null }],
      supplier_invoice: null,
      rupee_rate: 8325,
      freight_paise: 0,
      duty_paise: 0,
      clearing_paise: 0,
      note: null,
    });
    expect((await refund(id, "failed_check")).status).toBe(200);
  });
});

describe("a client's custom orders, on their Home", () => {
  it("lists each still in hand with where it stands, the link to pay while unpaid, never the supplier's price", async () => {
    const [order] = (await (await raise()).json<Orders>()).orders;
    const cookie = await signedIn(PERSON);
    const mine = await (await asClient(cookie, "/api/me/custom-orders")).json<{ orders: Record<string, unknown>[] }>();
    expect(mine.orders).toEqual([
      {
        number: order?.number,
        status: "awaiting_payment",
        promised_on: "2026-10-20",
        amount: 4_500_000,
        pay_url: expect.stringMatching(/^https:\/\/rzp\.io\//) as string,
      },
    ]);
    await job.opsPost(`/api/custom-orders/${order?.id ?? ""}/cancel`);
    expect((await (await asClient(cookie, "/api/me/custom-orders")).json<{ orders: unknown[] }>()).orders).toEqual([]);
  });
});
