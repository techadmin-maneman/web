// Payments and refunds recorded in Books, where the pass makes each client's Books customer itself. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/ops/alerts.ts";
import { CALLS_PER_RECORD, syncBooks, type BooksSyncSummary } from "../../../src/domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../../../src/domain/books/books-pass.ts";
import { createCallBudget, type CallBudget } from "../../../src/lib/call-budget.ts";
import { createLogger } from "../../../src/log.ts";
import { type BooksProvider } from "../../../src/providers/books/index.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { ZohoError } from "../../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "../helpers.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import {
  PERSON,
  VISIT,
  PAYMENT,
  sent,
  booksWith,
  optionsFor,
  PAYMENTS_TAB,
  payment,
  SECOND,
  secondPayment,
  invoiced,
  paymentRow,
  later,
  openAlerts,
  bothLooking,
  did,
} from "./books-sync-fixtures.ts";

/** What the pass told ops. */
let told: string[];

function depsFor(books: BooksProvider, now: Date) {
  const alert = (message: string) => {
    told.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return { books, alertOnce, resolveAlert };
}

/** One pass. The client's Books customer is `booksCustomerId`, the one an earlier pass kept on them; null for none yet. */
async function pass(
  books: BooksProvider,
  booksCustomerId: string | null,
  now = NOW,
  overrides: Partial<BooksSyncOptions> = {},
  budget: CallBudget = createCallBudget(Infinity),
): Promise<BooksSyncSummary> {
  if (booksCustomerId !== null) {
    await env.DB.prepare("UPDATE people SET books_customer_id = ?1 WHERE id = ?2 AND books_customer_id IS NULL")
      .bind(booksCustomerId, PERSON)
      .run();
  }
  return syncBooks({
    db: env.DB,
    deps: depsFor(books, now),
    options: optionsFor(overrides),
    now,
    log: createLogger(),
    budget,
  });
}

beforeEach(async () => {
  told = [];
  await env.DB.prepare(
    "INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra')",
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, window_start, window_end, synced_at, service_city)
     VALUES (?1, ?1, ?2, 'first_fit', 'scheduled', '2026-09-25T04:30:00.000Z', '2026-09-25T07:30:00.000Z', ?3,
       'Gurgaon')`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
});

describe("payments and refunds", () => {
  describe("recording payments", () => {
    it("records a captured payment against the client's Books record, once, labelled as a test on staging", async () => {
      await payment();
      const books = createStubBooks();
      expect(await pass(books, "books-customer-9")).toEqual(did({ recorded: 1 }));
      expect(books.made.payments).toEqual([
        {
          customerId: "books-customer-9",
          amount: 3000000,
          date: "2026-09-21",
          reference: "MM-2026-0841",
          description: "Staging test: Razorpay payment pay_test41",
          supply: "Staging test: Advance for First fit, Fri 25 Sep",
        },
      ]);
      expect((await paymentRow())?.books_payment_id).toMatch(/^stub-payment-/);

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(books.made.payments).toHaveLength(1);
    });

    it("finds by our reference a payment Books recorded whose answer never came, rather than recording it twice", async () => {
      await payment();
      const books = createStubBooks();
      books.loseAnswer("recordPayment");
      await pass(books, "books-customer-9");
      expect((await paymentRow())?.books_payment_id).toBeNull();

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(books.made.payments).toHaveLength(1);
      expect((await paymentRow())?.books_payment_id).toBe(await books.findPayment("books-customer-9", "MM-2026-0841"));
    });

    it("gives production's no label", async () => {
      await payment();
      const books = createStubBooks();
      await pass(books, "books-customer-9", NOW, { refundAccountId: null, labelAsTest: false });
      expect(books.made.payments[0]?.description).toBe("Razorpay payment pay_test41");
    });

    it("leaves an authorised payment until it is captured", async () => {
      await payment("authorized");
      const books = createStubBooks();
      await pass(books, "books-customer-9");
      expect(books.made.payments).toEqual([]);
    });

    it("logs a payment Books refuses, tells ops once, and waits an hour to try again", async () => {
      await payment();
      const books = {
        ...createStubBooks(),
        recordPayment: () => Promise.reject(new ZohoError(400, "1002", "customer inactive")),
      };
      const logs = captureLogs();
      await pass(books, "books-customer-9");
      expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "books_payment_refused", status: 400 }));
      expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: NOW.toISOString() });
      expect(told).toEqual([
        `Books refused payment ${PAYMENT} (Razorpay pay_test41), saying "customer inactive". It is asked again every ` +
          `hour. ${PAYMENTS_TAB}`,
      ]);

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS + 1000));
      expect(told).toHaveLength(1);
    });

    it("logs any other failure, leaves that payment an hour, and carries on with the next", async () => {
      await payment();
      await secondPayment();
      const stub = createStubBooks();
      const books = {
        ...stub,
        recordPayment: (details: Parameters<StubBooks["recordPayment"]>[0]) =>
          details.reference === "MM-2026-0841"
            ? Promise.reject(new ZohoError(503, "UNAVAILABLE", "try later"))
            : stub.recordPayment(details),
      };
      const logs = captureLogs();

      expect(await pass(books, "books-customer-9")).toEqual(did({ recorded: 1 }));
      expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: NOW.toISOString() });
      expect(logs.lines()).toContainEqual(
        expect.objectContaining({ event: "books_payment_failed", payment_id: PAYMENT }),
      );
      expect(told).toEqual([]);
    });

    it("tells ops once a failure has lasted three passes, and closes it when the payment is recorded", async () => {
      await payment();
      let failing = true;
      const stub = createStubBooks();
      const books = {
        ...stub,
        recordPayment: (details: Parameters<StubBooks["recordPayment"]>[0]) =>
          failing ? Promise.reject(new ZohoError(503, "UNAVAILABLE", "try later")) : stub.recordPayment(details),
      };
      for (const hours of [0, 1, 2]) await pass(books, "books-customer-9", later(hours * (RECHECK_AFTER_MS + 1000)));
      expect(told).toEqual([
        expect.stringContaining(`Books has failed 3 times on payment ${PAYMENT} (Razorpay pay_test41)`) as string,
      ]);

      failing = false;
      await pass(books, "books-customer-9", later(3 * (RECHECK_AFTER_MS + 1000)));
      expect(await openAlerts()).toEqual({ n: 0 });
    });

    // A run that outlasts five minutes overlaps the next.
    it("records a payment once when two passes run at the same time", async () => {
      await payment();
      const stub = createStubBooks();
      const looked = bothLooking();
      const books = {
        ...stub,
        findPayment: async (customerId: string, reference: string) => {
          await looked.wait();
          return stub.findPayment(customerId, reference);
        },
      };
      const [first, second] = await Promise.all([pass(books, "books-customer-9"), pass(books, "books-customer-9")]);
      expect(first.recorded + second.recorded).toBe(1);
      expect(looked.times()).toBe(1);
      expect(stub.made.payments).toHaveLength(1);
    });
  });

  describe("the pass's outside calls", () => {
    it("handles only the records the cron run can pay for; the rest are the next run's", async () => {
      await payment();
      await secondPayment();
      const books = createStubBooks();

      const budget = createCallBudget(CALLS_PER_RECORD);
      expect(await pass(books, "books-customer-9", NOW, {}, budget)).toEqual(did({ recorded: 1 }));
      const second = await env.DB.prepare("SELECT books_payment_id, books_checked_at FROM payments WHERE id = ?1")
        .bind(SECOND)
        .first();
      expect(second).toEqual({ books_payment_id: null, books_checked_at: null });
    });
  });

  describe("applying a payment to its invoice", () => {
    it("sets the payment against its visit's sent invoice, once", async () => {
      await payment();
      await invoiced("inv-41");
      const books = booksWith(sent());
      expect(await pass(books, "books-customer-9")).toEqual(did({ recorded: 1, applied: 1 }));
      expect(books.made.applied).toEqual([
        { paymentId: expect.stringMatching(/^stub-payment-/) as string, invoiceId: "inv-41", amount: 3000000 },
      ]);
      expect((await paymentRow())?.books_applied_at).toBe(NOW.toISOString());

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(books.made.applied).toHaveLength(1);
    });

    // What the invoice did not owe stayed in Books as the client's credit, and nobody was told.
    it("applies no more than the invoice still owes, and tells ops once of what is left over", async () => {
      await payment();
      await invoiced("inv-41");
      const books = booksWith(sent({ balance: 1200000 }));
      await pass(books, "books-customer-9");
      expect(books.made.applied[0]?.amount).toBe(1200000);
      expect(told).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Payment ${PAYMENT} \\(Books stub-payment-.+\\) was Rs\\. 30,000, and invoice inv-41 owed Rs\\. 12,000 of ` +
              "it, so Rs\\. 18,000 has nothing to be set against\\. It stays in Books as credit owed to the client",
          ),
        ) as string,
      ]);
    });

    it("waits an hour while the invoice is a draft", async () => {
      await payment();
      await invoiced("inv-41");
      let invoice = sent({ status: "draft" });
      const books = { ...createStubBooks(), invoice: () => Promise.resolve(invoice) };
      await pass(books, "books-customer-9");
      expect(await paymentRow()).toMatchObject({ books_applied_at: null, books_checked_at: NOW.toISOString() });

      invoice = sent();
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS / 2));
      expect(books.made.applied).toEqual([]);
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS + 1000));
      expect(books.made.applied).toHaveLength(1);
    });

    it("leaves a paid, void or missing invoice to ops, and logs it", async () => {
      for (const invoice of [sent({ balance: 0, status: "paid" }), sent({ status: "void" }), null]) {
        await env.DB.prepare("DELETE FROM payments").run();
        await payment();
        await invoiced("inv-41");
        const books = booksWith(invoice);
        const logs = captureLogs();
        await pass(books, "books-customer-9");
        expect(books.made.applied).toEqual([]);
        expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "books_apply_skipped" }));
        expect((await paymentRow())?.books_applied_at).toBe(NOW.toISOString());
      }
    });

    it("tells ops, once, of a payment with nothing to set it against: it stays in Books as the client's credit", async () => {
      await payment();
      await invoiced("inv-41");
      const books = booksWith(sent({ balance: 0, status: "paid" }));
      await pass(books, "books-customer-9");
      expect(told).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Payment ${PAYMENT} \\(Books stub-payment-.+\\) has nothing to be set against: invoice inv-41 is paid\\.`,
          ),
        ) as string,
      ]);
      expect(told[0]).toContain(PAYMENTS_TAB);
    });

    it("logs a payment Books will not apply, tells ops, and does not try again", async () => {
      await payment();
      await invoiced("inv-41");
      const books = {
        ...booksWith(sent()),
        applyToInvoice: () => Promise.reject(new ZohoError(400, "24016", "amount exceeds balance")),
      };
      const logs = captureLogs();
      await pass(books, "books-customer-9");
      expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "books_apply_refused", code: "24016" }));
      expect((await paymentRow())?.books_applied_at).toBe(NOW.toISOString());
      expect(told).toEqual([
        `Books refused payment ${PAYMENT} against invoice inv-41, saying "amount exceeds balance". Set it against the invoice in Books by hand. ${PAYMENTS_TAB}`,
      ]);
    });

    it("tries again in an hour when Books fails to apply a payment for any other reason", async () => {
      await payment();
      await invoiced("inv-41");
      const books = {
        ...booksWith(sent()),
        applyToInvoice: () => Promise.reject(new ZohoError(502, "BAD_GATEWAY", "try later")),
      };
      await pass(books, "books-customer-9");
      expect(await paymentRow()).toMatchObject({ books_applied_at: null, books_checked_at: NOW.toISOString() });
    });

    it("waits for the invoice", async () => {
      await payment();
      const books = booksWith(sent());
      await pass(books, "books-customer-9");
      expect(books.made.applied).toEqual([]);
      expect((await paymentRow())?.books_applied_at).toBeNull();
    });
  });
});
