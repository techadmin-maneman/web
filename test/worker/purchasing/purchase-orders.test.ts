// Purchase orders (src/routes/ops/purchasing.ts, src/domain/purchasing/purchase-orders.ts;
// docs/decisions/0166-purchase-orders.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: an order is drafted from an active supplier's list at its prices, at least its minimum of each; it
// needs two approvers, never the same one twice, unless it is in rupees and worth no more than the amount ops set; and
// it is marked sent, or cancelled with why, once.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { needsSecondApproval } from "../../../src/policy/purchasing.ts";
import { A_NUMBER, markDatabase, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

let job: Working;
let supplier: string;

interface Orders {
  orders: {
    id: string;
    number: number;
    state: string;
    total: number;
    currency: string;
    approved_by: string | null;
    second_approved_by: string | null;
    cancel_reason: string | null;
    needs_second_approval: boolean;
    lines: { consumable_code: string; quantity: number; unit_price: number }[];
  }[];
}

const fieldsOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;
const draft = (lines: { consumable_code: string; quantity: number }[], to = supplier) =>
  job.opsPost("/api/purchase-orders", { supplier_id: to, lines, expected_on: "2026-10-15", note: null });
const firstOrder = async (res: Response) => (await res.json<Orders>()).orders[0];

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await job.opsPost("/api/consumables", { name: "Tape strips", unit: "strip", unit_cost: 1200 });
  const added = await job.opsPost("/api/suppliers", {
    name: "Kesh Supplies",
    gstin: null,
    country: "IN",
    currency: "INR",
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 15,
    warranty_days: 0,
  });
  supplier = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
  await job.opsPost(`/api/suppliers/${supplier}/items`, {
    consumable_code: "solvent",
    their_code: null,
    unit_price: 4500,
    pack_size: 12,
    minimum_order: 24,
    lead_time_days: 7,
  });
});

describe("drafting an order", () => {
  it("takes each line at the supplier's price, and refuses one it does not list or below its minimum", async () => {
    const drafted = await draft([{ consumable_code: "solvent", quantity: 48 }]);
    expect(drafted.status).toBe(200);
    expect(await firstOrder(drafted)).toMatchObject({
      number: A_NUMBER,
      state: "drafted",
      currency: "INR",
      total: 216_000,
      lines: [{ consumable_code: "solvent", quantity: 48, unit_price: 4500 }],
    });
    expect((await fieldsOf(await draft([{ consumable_code: "tape_strips", quantity: 50 }]))).fields).toEqual([
      "lines.0",
    ]);
    expect((await fieldsOf(await draft([{ consumable_code: "solvent", quantity: 12 }]))).fields).toEqual(["lines.0"]);
    const twice = [
      { consumable_code: "solvent", quantity: 24 },
      { consumable_code: "solvent", quantity: 24 },
    ];
    expect((await fieldsOf(await draft(twice))).fields).toEqual(["lines"]);
    await job.opsPost(`/api/suppliers/${supplier}/retire`);
    expect((await fieldsOf(await draft([{ consumable_code: "solvent", quantity: 24 }]))).fields).toEqual([
      "supplier_id",
    ]);
  });
});

describe("approving an order", () => {
  it("needs two different approvers until ops set an amount, never the same one twice", async () => {
    const id = (await firstOrder(await draft([{ consumable_code: "solvent", quantity: 48 }])))?.id ?? "";
    const once = await job.opsPost(`/api/purchase-orders/${id}/approve`);
    expect(await firstOrder(once)).toMatchObject({ state: "drafted", approved_by: "ops@localhost" });
    const again = await job.opsPost(`/api/purchase-orders/${id}/approve`);
    expect((await fieldsOf(again)).code).toBe("same_approver");

    // Another manager approved first; this one gives the second approval.
    await env.DB.prepare("UPDATE purchase_orders SET approved_by = 'first@maneman.in' WHERE id = ?1").bind(id).run();
    const second = await job.opsPost(`/api/purchase-orders/${id}/approve`);
    expect(await firstOrder(second)).toMatchObject({ state: "approved", second_approved_by: "ops@localhost" });
  });

  it("needs one approver for an order in rupees worth no more than the amount ops set", async () => {
    await job.opsPost("/api/settings/po_second_approval_above_rupees", { value: 5000 });
    const small = (await firstOrder(await draft([{ consumable_code: "solvent", quantity: 24 }])))?.id ?? "";
    const approved = await job.opsPost(`/api/purchase-orders/${small}/approve`);
    expect(await firstOrder(approved)).toMatchObject({ state: "approved", needs_second_approval: false });
  });

  it("needs two for an order in a currency with no rate set, whatever it is worth", () => {
    expect(needsSecondApproval({ currency: "USD", total: 100 }, 1_000_000)).toBe(true);
    expect(needsSecondApproval({ currency: "INR", total: 500_000 }, 5000)).toBe(false);
    expect(needsSecondApproval({ currency: "INR", total: 500_001 }, 5000)).toBe(true);
  });

  it("judges an order in another currency in rupees, at the rate ops set for it", () => {
    const rates = { default: 0, USD: 84 };
    // USD 140.00 at Rs. 84 is Rs. 11,760.
    expect(needsSecondApproval({ currency: "USD", total: 14_000 }, 50_000, rates)).toBe(false);
    expect(needsSecondApproval({ currency: "USD", total: 14_000 }, 10_000, rates)).toBe(true);
    expect(needsSecondApproval({ currency: "CNY", total: 14_000 }, 50_000, rates)).toBe(true);
  });

  // A yen total is whole yen: read as hundredths, a JPY 200,000 order came to Rs. 1,120 and went out on one approval.
  it("reads a total in its currency's own smallest unit", () => {
    const rates = { default: 0, JPY: 0.56 };
    expect(needsSecondApproval({ currency: "JPY", total: 200_000 }, 100_000, rates)).toBe(true);
    expect(needsSecondApproval({ currency: "JPY", total: 200_000 }, 120_000, rates)).toBe(false);
  });
});

describe("an approved order", () => {
  it("is marked sent, or cancelled with why, once", async () => {
    await job.opsPost("/api/settings/po_second_approval_above_rupees", { value: 100_000 });
    const id = (await firstOrder(await draft([{ consumable_code: "solvent", quantity: 24 }])))?.id ?? "";
    expect((await fieldsOf(await job.opsPost(`/api/purchase-orders/${id}/send`))).code).toBe("order_state");
    await job.opsPost(`/api/purchase-orders/${id}/approve`);
    expect(await firstOrder(await job.opsPost(`/api/purchase-orders/${id}/send`))).toMatchObject({ state: "sent" });
    const cancelled = await job.opsPost(`/api/purchase-orders/${id}/cancel`, { reason: "Supplier out of stock" });
    expect(await firstOrder(cancelled)).toMatchObject({ state: "cancelled", cancel_reason: "Supplier out of stock" });
    const again = await job.opsPost(`/api/purchase-orders/${id}/cancel`, { reason: "Twice" });
    expect((await fieldsOf(again)).code).toBe("order_state");
    expect((await job.opsPost("/api/purchase-orders/nothing/send")).status).toBe(404);
    const audited = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action LIKE 'purchase_order.%' ORDER BY rowid",
    ).all<{ action: string }>();
    expect(audited.results.map((row) => row.action)).toEqual([
      "purchase_order.draft",
      "purchase_order.approve",
      "purchase_order.send",
      "purchase_order.cancel",
    ]);
  });
});

describe("the letterhead a printed order carries", () => {
  const LETTERHEAD = { legal_name: "Mane Man Private Limited", gstin: null, deliver_to: "Sector 37" };

  it("is none until set, then is the one row each change replaces, the CIN and GSTIN taken in capitals", async () => {
    const read = async () =>
      (await (await request(job.ops, "/api/purchase-orders")).json<{ letterhead: unknown }>()).letterhead;
    expect(await read()).toBeNull();

    expect((await job.opsPost("/api/purchase-orders/letterhead", LETTERHEAD)).status).toBe(200);
    expect(await read()).toEqual({ ...LETTERHEAD, registered_office: null, cin: null });
    const again = {
      ...LETTERHEAD,
      registered_office: "Plot 12, Okhla Phase II\nNew Delhi 110020",
      cin: "u74999dl2026ptc123456",
      gstin: "06aabcm1234a1z5",
      deliver_to: "Warehouse 4, Sector 37\nGurgaon 122001",
    };
    expect((await job.opsPost("/api/purchase-orders/letterhead", again)).status).toBe(200);
    expect(await read()).toEqual({ ...again, cin: "U74999DL2026PTC123456", gstin: "06AABCM1234A1Z5" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM po_letterhead").first("n")).toBe(1);
    const audited = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?1")
      .bind("purchase_order.letterhead_set")
      .first("n");
    expect(audited).toBe(2);
  });

  it("refuses a GSTIN or a CIN that is not one, and an empty address", async () => {
    const refused = await job.opsPost("/api/purchase-orders/letterhead", {
      ...LETTERHEAD,
      cin: "U123",
      gstin: "123",
      deliver_to: "",
    });
    expect(refused.status).toBe(400);
    expect((await fieldsOf(refused)).fields).toEqual(expect.arrayContaining(["cin", "gstin", "deliver_to"]));
  });
});
