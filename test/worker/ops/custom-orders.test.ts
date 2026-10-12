// Custom orders (src/routes/ops/custom-orders.ts, src/domain/field/custom-orders.ts,
// src/domain/money/custom-order-links.ts, src/domain/field/custom-order-po.ts; docs/decisions/0174-custom-orders.md).
// NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: a custom order is raised to the client's profile and its whole price asked by a payment link; once
// Razorpay says it is paid, the payment is the client's, the order paid, and a purchase order of its own drafted to
// its supplier with the stock code made to its spec, however often Razorpay says so; one not yet paid may be
// cancelled, its link with it; and a profile missing part of the spec, or a retired supplier, is refused.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createStubPayments, type StubPayments } from "../../../src/providers/payments/stub.ts";
import { captureLogs, deliverRazorpay, markDatabase, NOW, request } from "../helpers.ts";
import { PERSON, working, type Working } from "../job-fixtures.ts";

interface Orders {
  orders: { id: string; number: number; status: string; short_url: string | null; po_number: number | null }[];
  suppliers: { id: string; name: string }[];
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
  job = await working("service", { payments });
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
    const raised = await raise();
    expect(raised.status).toBe(200);
    const [order] = (await raised.json<Orders>()).orders;
    expect(order).toMatchObject({ number: 1, status: "awaiting_payment" });
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

    expect((await orders()).orders[0]).toMatchObject({ status: "paid", po_number: 1 });
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
  });
});
