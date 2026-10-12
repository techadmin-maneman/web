// Receipts as bills in Zoho Books (src/domain/books/books-bills.ts; docs/decisions/0168-bills-in-books.md). NOW is
// Monday 21 September 2026, 12 noon in India.
//
// What these hold: each supplier with a receipt becomes a vendor once, and each receipt a bill once, of what the
// supplier invoiced at the price ordered, a hair system's lines on the cost of goods sold and a consumable's on raw
// materials and consumables; a bill whose answer never came is found by its reference, not made twice; Books' refusal
// reaches ops; and without both accounts no bill is made.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { syncBooks } from "../../../src/domain/books/books-sync.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/ops/alerts.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { markDatabase, NOW } from "../helpers.ts";
import { working, type Working } from "../job-fixtures.ts";
import { optionsFor } from "./books-sync-fixtures.ts";

const ACCOUNTS = { hairSystems: "acc-cogs", consumables: "acc-raw" };

let job: Working;
let told: string[];
let hair: string;

function pass(books: StubBooks, now = NOW, accounts: typeof ACCOUNTS | null = ACCOUNTS) {
  const alert = (message: string) => {
    told.push(message);
    return Promise.resolve();
  };
  const deps = {
    books,
    alertOnce: createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() }),
    resolveAlert: createResolveAlert({ db: env.DB, now: () => now }),
  };
  return syncBooks({
    db: env.DB,
    deps,
    options: optionsFor({ refundAccountId: null, billAccounts: accounts }),
    now,
    log: createLogger(),
    budget: createCallBudget(Infinity),
  });
}

/** An order to a supplier in USD for a hair system and solvent, sent and then received with an invoice number. */
async function received(): Promise<void> {
  const added = await job.opsPost("/api/suppliers", {
    name: "Lumina Hair Co",
    gstin: null,
    country: "CN",
    currency: "USD",
    contact_name: null,
    contact_phone: null,
    contact_email: "orders@lumina.example",
    payment_terms_days: 30,
    warranty_days: 90,
  });
  const supplier = (await added.json<{ suppliers: { id: string }[] }>()).suppliers[0]?.id ?? "";
  for (const [code, price] of [
    [hair, 12_000],
    ["solvent", 250],
  ] as const) {
    await job.opsPost(`/api/suppliers/${supplier}/items`, {
      consumable_code: code,
      their_code: null,
      unit_price: price,
      pack_size: 1,
      minimum_order: 1,
      lead_time_days: 14,
    });
  }
  const drafted = await job.opsPost("/api/purchase-orders", {
    supplier_id: supplier,
    lines: [
      { consumable_code: hair, quantity: 2 },
      { consumable_code: "solvent", quantity: 10 },
    ],
    expected_on: null,
    note: null,
  });
  const order = (await drafted.json<{ orders: { id: string; lines: { id: string }[] }[] }>()).orders[0];
  const id = order?.id ?? "";
  await env.DB.prepare(
    "UPDATE purchase_orders SET state = 'sent', approved_by = 'a@maneman.in', second_approved_by = 'b@maneman.in' WHERE id = ?1",
  )
    .bind(id)
    .run();
  const [hairLine, solventLine] = order?.lines ?? [];
  const line = (lineId: string | undefined, received: number, qcFailed = 0) => ({
    po_line_id: lineId ?? "",
    received,
    damaged: 0,
    qc_failed: qcFailed,
    lot_code: null,
    expires_on: null,
  });
  const answer = await job.opsPost(`/api/purchase-orders/${id}/receipts`, {
    lines: [line(hairLine?.id, 1, 1), line(solventLine?.id, 10)],
    supplier_invoice: "LUM-2209",
    rupee_rate: 8325,
    freight_paise: 0,
    duty_paise: 0,
    clearing_paise: 0,
    note: null,
  });
  expect(answer.status).toBe(200);
}

beforeEach(async () => {
  await markDatabase();
  told = [];
  job = await working();
  await job.opsPost("/api/consumables", { name: "Solvent", unit: "ml", unit_cost: 50 });
  await env.DB.prepare(
    `INSERT INTO services (kind, tier, name, minutes, sort, updated_by, updated_at)
     VALUES ('first_fit', 'essential', 'Mane Man Essential', 120, 1, 'test', ?1)`,
  )
    .bind(NOW.toISOString())
    .run();
  const added = await job.opsPost("/api/hair-systems", {
    product: "essential",
    base_width_in: 8,
    base_length_in: 10,
    colour: "1B",
    grey_percent: 20,
    density_percent: 100,
    unit_cost: 1_200_000,
  });
  hair = (await added.json<{ code: string }>()).code;
  await received();
});

describe("a receipt in Books", () => {
  it("becomes one bill of its supplier's vendor, each line on its account, however often the sync runs", async () => {
    const books = createStubBooks();
    expect(await pass(books)).toMatchObject({ vendors: 1, bills: 1 });
    expect(books.made.vendors).toEqual([
      {
        name: "Staging test: Lumina Hair Co",
        gstin: null,
        currency: "USD",
        inIndia: false,
        email: "orders@lumina.example",
        phone: null,
        paymentTermsDays: 30,
      },
    ]);
    const [bill] = books.made.bills;
    expect(bill).toMatchObject({
      billNumber: "LUM-2209",
      date: "2026-09-21",
      dueDate: "2026-10-21",
      exchangeRate: 83.25,
    });
    expect(bill?.lines).toEqual([
      {
        description: "Staging test: Mane Man Essential 8x10 1B, 20% grey, 100% (PO-0001)",
        accountId: "acc-cogs",
        unitPrice: 12_000,
        quantity: 2,
      },
      { description: "Staging test: Solvent (PO-0001)", accountId: "acc-raw", unitPrice: 250, quantity: 10 },
    ]);

    expect(await pass(books, new Date(NOW.getTime() + RECHECK_AFTER_MS + 1000))).toMatchObject({
      vendors: 0,
      bills: 0,
    });
    expect(books.made.bills).toHaveLength(1);
  });

  it("is found by its reference, not made twice, when Books' answer never came", async () => {
    const books = createStubBooks();
    books.loseAnswer("createBill");
    expect(await pass(books)).toMatchObject({ bills: 0 });
    expect(await pass(books, new Date(NOW.getTime() + RECHECK_AFTER_MS + 1000))).toMatchObject({ bills: 1 });
    expect(books.made.bills).toHaveLength(1);
  });

  it("tells ops when Books refuses it, and waits for both accounts before making any", async () => {
    const idle = createStubBooks();
    expect(await pass(idle, NOW, null)).toMatchObject({ vendors: 0, bills: 0 });
    expect(idle.made.vendors).toEqual([]);

    const books = createStubBooks();
    books.refuseNext("createBill", "57");
    await pass(books);
    expect(told).toEqual([expect.stringContaining("Books refused the bill of PO-0001's receipt")]);
  });
});
