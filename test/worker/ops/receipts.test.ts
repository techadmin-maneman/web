// Receipts against purchase orders (src/routes/ops/purchasing.receipts.ts, src/domain/field/receipts.ts;
// docs/decisions/0167-receipts-and-landed-cost.md). NOW is Monday 21 September 2026, 12 noon in India.
//
// What these hold: what arrives of an order sent goes into the warehouse in its lot, the damaged and those that failed
// their check never do; each line's landed cost is the supplier's price in rupees and its share of the extras, kept on
// its lot; a hair system's pieces are labelled as they arrive; the order is part received, then received, or closed
// short; and a receipt is refused against an order not sent, a line not of it, or another currency with no rate.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { landedUnitCosts } from "../../../src/policy/purchasing.ts";
import { markDatabase, NOW, request } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";

let job: Working;

interface Orders {
  orders: {
    id: string;
    state: string;
    lines: { id: string; consumable_code: string; received: number }[];
    receipts: { lines: { received: number; landed_unit_paise: number }[] }[];
  }[];
}

const fieldsOf = async (res: Response) => (await res.json<{ error: { code: string; fields?: string[] } }>()).error;
const held = async (code: string) =>
  (await env.DB.prepare("SELECT quantity FROM stock_balances WHERE consumable_code = ?1 AND place = 'central'")
    .bind(code)
    .first<number>("quantity")) ?? 0;

async function supplierOf(currency: string, items: { code: string; price: number }[]): Promise<string> {
  const added = await job.opsPost("/api/suppliers", {
    name: `Supplier ${currency}`,
    gstin: null,
    country: currency === "INR" ? "IN" : "CN",
    currency,
    contact_name: null,
    contact_phone: null,
    contact_email: null,
    payment_terms_days: 0,
    warranty_days: 90,
  });
  const id =
    (await added.json<{ suppliers: { id: string; name: string }[] }>()).suppliers.find(
      (each) => each.name === `Supplier ${currency}`,
    )?.id ?? "";
  for (const item of items) {
    await job.opsPost(`/api/suppliers/${id}/items`, {
      consumable_code: item.code,
      their_code: null,
      unit_price: item.price,
      pack_size: 1,
      minimum_order: 1,
      lead_time_days: 14,
    });
  }
  return id;
}

/** An order to the supplier, drafted, approved twice and sent. */
async function sentOrder(supplier: string, lines: { consumable_code: string; quantity: number }[]) {
  const drafted = await job.opsPost("/api/purchase-orders", {
    supplier_id: supplier,
    lines,
    expected_on: null,
    note: null,
  });
  const order = (await drafted.json<Orders>()).orders[0];
  const id = order?.id ?? "";
  await job.opsPost(`/api/purchase-orders/${id}/approve`);
  await env.DB.prepare("UPDATE purchase_orders SET approved_by = 'first@maneman.in' WHERE id = ?1").bind(id).run();
  await job.opsPost(`/api/purchase-orders/${id}/approve`);
  await job.opsPost(`/api/purchase-orders/${id}/send`);
  return { id, lines: order?.lines ?? [] };
}

const receipt = (lines: Record<string, unknown>[], more: Record<string, unknown> = {}) => ({
  lines,
  supplier_invoice: "INV-88",
  rupee_rate: null,
  freight_paise: 0,
  duty_paise: 0,
  clearing_paise: 0,
  note: null,
  ...more,
});

const line = (id: string, received: number, more: Record<string, unknown> = {}) => ({
  po_line_id: id,
  received,
  damaged: 0,
  qc_failed: 0,
  lot_code: null,
  expires_on: null,
  ...more,
});

beforeEach(async () => {
  await markDatabase();
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
});

describe("a receipt against an order in rupees", () => {
  it("brings what arrived into the warehouse in its lot, at its landed cost, and moves the order on", async () => {
    const supplier = await supplierOf("INR", [{ code: "solvent", price: 4500 }]);
    const order = await sentOrder(supplier, [{ consumable_code: "solvent", quantity: 48 }]);
    const lineId = order.lines[0]?.id ?? "";

    const first = await job.opsPost(
      `/api/purchase-orders/${order.id}/receipts`,
      receipt([line(lineId, 24, { damaged: 2, lot_code: "SV-7", expires_on: "2027-09-30" })], {
        freight_paise: 24_000,
      }),
    );
    expect(first.status).toBe(200);
    const after = (await first.json<Orders>()).orders.find((each) => each.id === order.id);
    expect(after?.state).toBe("part_received");
    expect(after?.receipts[0]?.lines[0]).toMatchObject({ received: 24, landed_unit_paise: 5500 });
    expect(await held("solvent")).toBe(24);
    expect(
      await env.DB.prepare("SELECT landed_cost_paise FROM stock_lots WHERE lot_code = 'SV-7'").first<number>(
        "landed_cost_paise",
      ),
    ).toBe(5500);

    const rest = await job.opsPost(`/api/purchase-orders/${order.id}/receipts`, receipt([line(lineId, 24)]));
    expect((await rest.json<Orders>()).orders.find((each) => each.id === order.id)?.state).toBe("received");
    expect(await held("solvent")).toBe(48);
  });

  it("closes an order short, and refuses a receipt it cannot take", async () => {
    const supplier = await supplierOf("INR", [{ code: "solvent", price: 4500 }]);
    const drafted = await job.opsPost("/api/purchase-orders", {
      supplier_id: supplier,
      lines: [{ consumable_code: "solvent", quantity: 10 }],
      expected_on: null,
      note: null,
    });
    const draftId = (await drafted.json<Orders>()).orders[0]?.id ?? "";
    const draftLine =
      (await (await request(job.ops, "/api/purchase-orders")).json<Orders>()).orders[0]?.lines[0]?.id ?? "";
    const early = await job.opsPost(`/api/purchase-orders/${draftId}/receipts`, receipt([line(draftLine, 5)]));
    expect((await fieldsOf(early)).code).toBe("order_state");

    const order = await sentOrder(supplier, [{ consumable_code: "solvent", quantity: 10 }]);
    const lineId = order.lines[0]?.id ?? "";
    expect(
      (await fieldsOf(await job.opsPost(`/api/purchase-orders/${order.id}/receipts`, receipt([line(draftLine, 5)]))))
        .fields,
    ).toEqual(["lines.0"]);
    expect(
      (await fieldsOf(await job.opsPost(`/api/purchase-orders/${order.id}/receipts`, receipt([line(lineId, 0)]))))
        .fields,
    ).toEqual(["lines"]);
    await job.opsPost(`/api/purchase-orders/${order.id}/receipts`, receipt([line(lineId, 6)]));
    const closed = await job.opsPost(`/api/purchase-orders/${order.id}/close`);
    expect((await closed.json<Orders>()).orders.find((each) => each.id === order.id)?.state).toBe("closed");
  });
});

describe("a receipt against an order in another currency", () => {
  it("takes the rupee rate, shares the extras by value, and labels each hair system piece", async () => {
    const hair = await job.opsPost("/api/hair-systems", {
      product: "essential",
      base_width_in: 8,
      base_length_in: 10,
      colour: "1B",
      grey_percent: 20,
      density_percent: 100,
      unit_cost: 1_200_000,
    });
    const code = (await hair.json<{ code: string }>()).code;
    const supplier = await supplierOf("USD", [{ code, price: 12_000 }]);
    const order = await sentOrder(supplier, [{ consumable_code: code, quantity: 3 }]);
    const lineId = order.lines[0]?.id ?? "";

    const noRate = await job.opsPost(`/api/purchase-orders/${order.id}/receipts`, receipt([line(lineId, 2)]));
    expect((await fieldsOf(noRate)).fields).toEqual(["rupee_rate"]);
    const received = await job.opsPost(
      `/api/purchase-orders/${order.id}/receipts`,
      receipt([line(lineId, 2, { qc_failed: 1, lot_code: "HS-9" })], { rupee_rate: 8325, duty_paise: 300_000 }),
    );
    const landed = (await received.json<Orders>()).orders.find((each) => each.id === order.id)?.receipts[0]?.lines[0];
    // $120.00 at Rs. 83.25 is Rs. 9,990; the duty of Rs. 3,000 shared over two pieces adds Rs. 1,500 each.
    expect(landed?.landed_unit_paise).toBe(1_149_000);
    const units = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM stock_units WHERE consumable_code = ?1 AND place = 'central' AND state = 'held'",
    )
      .bind(code)
      .first<number>("n");
    expect(units).toBe(2);
  });
});

describe("the landed cost", () => {
  it("shares the extras by value, and by count where no line brought value", () => {
    expect(
      landedUnitCosts(
        [
          { unitPrice: 1000, received: 10 },
          { unitPrice: 3000, received: 10 },
        ],
        100,
        4000,
      ),
    ).toEqual([1100, 3300]);
    expect(landedUnitCosts([{ unitPrice: 0, received: 4 }], 100, 400)).toEqual([100]);
    expect(landedUnitCosts([{ unitPrice: 500, received: 0 }], 100, 400)).toEqual([500]);
  });
});
