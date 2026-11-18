// Razorpay's settlements recorded in Books by the Books pass (src/domain/books/books-settlements.ts): the payout a
// transfer from Razorpay's account to the bank, and Razorpay's fee an expense paid out of Razorpay's account. Every name
// and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/platform/alerts.ts";
import { syncBooks, type BooksSyncSummary } from "../../../src/domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../../../src/domain/books/books-pass.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import { createCallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { NOW } from "../helpers.ts";
import { later, openAlerts, optionsFor } from "./books-sync-fixtures.ts";

const ACCOUNTS = { razorpay: "acct-razorpay", bank: "acct-kotak", fees: "acct-fees", feesGst: null };
/** Razorpay's registration in Karnataka, ours in Delhi. */
const FEES_GST = { supplierGstin: "29AAGCR4375J1ZU", sourceState: "KA", destinationState: "DL" };

/** What the pass told ops. */
let told: string[];

function pass(books: StubBooks, now = NOW, overrides: Partial<BooksSyncOptions> = {}): Promise<BooksSyncSummary> {
  const alert = (message: string) => {
    told.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return syncBooks({
    db: env.DB,
    deps: { books, alertOnce, resolveAlert },
    options: optionsFor({ settlementAccounts: ACCOUNTS, ...overrides }),
    now,
    log: createLogger(),
    budget: createCallBudget(Infinity),
  });
}

/** A settlement kept from Razorpay: ₹19,000 to the bank on 20 September, 9 pm in India, after a ₹472 fee. */
async function settled(id: string, { fees = 47_200, utr = `UTR${id}` as string | null } = {}) {
  await env.DB.prepare(
    `INSERT INTO razorpay_settlements (id, amount, fees, tax, utr, settled_at, received_at)
     VALUES (?1, 1900000, ?2, ?3, ?4, '2026-09-20T15:30:00.000Z', ?5)`,
  )
    .bind(id, fees, Math.round((fees * 0.18) / 1.18), utr, NOW.toISOString())
    .run();
}

const row = (id: string) =>
  env.DB.prepare("SELECT books_transfer_id, books_fee_id FROM razorpay_settlements WHERE id = ?1")
    .bind(id)
    .first<{ books_transfer_id: string | null; books_fee_id: string | null }>();

beforeEach(() => {
  told = [];
});

describe("a settlement in Books", () => {
  it("is a transfer to the bank under its UTR and an expense of its fee, each recorded once", async () => {
    await settled("setl_1");
    const books = createStubBooks();

    expect(await pass(books)).toMatchObject({ settled: 1 });
    expect(books.made.transfers).toEqual([
      {
        fromAccountId: "acct-razorpay",
        toAccountId: "acct-kotak",
        amount: 1_900_000,
        date: "2026-09-20",
        reference: "UTRsetl_1",
        description: "Staging test: Razorpay settlement setl_1",
      },
    ]);
    expect(books.made.expenses).toEqual([
      {
        accountId: "acct-fees",
        paidThroughAccountId: "acct-razorpay",
        amount: 47_200,
        date: "2026-09-20",
        reference: "setl_1",
        description: "Staging test: Razorpay's fee on settlement setl_1",
        gst: null,
      },
    ]);
    expect(await row("setl_1")).toEqual({
      books_transfer_id: expect.stringMatching(/^stub-transfer-/) as string,
      books_fee_id: expect.stringMatching(/^stub-expense-/) as string,
    });

    expect(await pass(books, later(RECHECK_AFTER_MS * 2))).toMatchObject({ settled: 0 });
    expect(books.made.transfers).toHaveLength(1);
    expect(books.made.expenses).toHaveLength(1);
  });

  it("carries the fee's GST at the rate Razorpay's figures come to, and is found by its own ID with no UTR", async () => {
    await settled("setl_2", { utr: null });
    const books = createStubBooks();
    await pass(books, NOW, { settlementAccounts: { ...ACCOUNTS, feesGst: FEES_GST } });
    expect(books.made.transfers).toEqual([expect.objectContaining({ reference: "setl_2" })]);
    expect(books.made.expenses).toEqual([
      expect.objectContaining({ amount: 47_200, gst: { ...FEES_GST, percent: 18, intraState: false } }),
    ]);
  });

  it("carries the GST group within one state, and no GST on a fee Razorpay charged none on", async () => {
    await settled("setl_6");
    await env.DB.prepare(
      `INSERT INTO razorpay_settlements (id, amount, fees, tax, utr, settled_at, received_at)
       VALUES ('setl_7', 1900000, 40000, 0, 'UTR7', '2026-09-20T15:30:00.000Z', ?1)`,
    )
      .bind(NOW.toISOString())
      .run();
    const books = createStubBooks();
    const sameState = { ...FEES_GST, sourceState: "DL" };
    await pass(books, NOW, { settlementAccounts: { ...ACCOUNTS, feesGst: sameState } });
    expect(books.made.expenses).toEqual([
      expect.objectContaining({ reference: "setl_6", gst: { ...sameState, percent: 18, intraState: true } }),
      expect.objectContaining({ reference: "setl_7", gst: null }),
    ]);
  });

  it("has no expense where Razorpay took no fee", async () => {
    await settled("setl_3", { fees: 0 });
    const books = createStubBooks();
    expect(await pass(books)).toMatchObject({ settled: 1 });
    expect(books.made.transfers).toHaveLength(1);
    expect(books.made.expenses).toEqual([]);
  });

  it("is not recorded until Razorpay's, the bank's and the fee's accounts are set", async () => {
    await settled("setl_4");
    const books = createStubBooks();
    await pass(books, NOW, { settlementAccounts: null });
    expect(books.made.transfers).toEqual([]);
    expect(await row("setl_4")).toEqual({ books_transfer_id: null, books_fee_id: null });
  });

  it("whose fee Books refused is told to ops at once, and asked again an hour on without a second transfer", async () => {
    await settled("setl_5");
    const books = createStubBooks();
    books.refuseNext("recordExpense");

    expect(await pass(books)).toMatchObject({ settled: 0 });
    expect(told).toEqual([expect.stringContaining("Books refused Razorpay's settlement setl_5")]);
    expect((await row("setl_5"))?.books_fee_id).toBeNull();

    expect(await pass(books, later(RECHECK_AFTER_MS / 2))).toMatchObject({ settled: 0 });
    expect(await pass(books, later(RECHECK_AFTER_MS * 2))).toMatchObject({ settled: 1 });
    expect(books.made.transfers).toHaveLength(1);
    expect(books.made.expenses).toHaveLength(1);
    expect(await openAlerts()).toEqual({ n: 0 });
  });

  it("is recorded once when Books' answer to the transfer never came", async () => {
    await settled("setl_6");
    const books = createStubBooks();
    books.loseAnswer("recordTransfer");
    await pass(books);
    expect((await row("setl_6"))?.books_transfer_id).toBeNull();

    await pass(books, later(RECHECK_AFTER_MS * 2));
    expect(books.made.transfers).toHaveLength(1);
    expect(books.made.expenses).toHaveLength(1);
  });
});
