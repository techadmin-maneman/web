// Payments and refunds recorded in Books, where the pass makes each client's Books customer itself. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../../src/domain/ops/alerts.ts";
import { syncBooks, type BooksSyncSummary } from "../../../src/domain/books/books-sync.ts";
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
  optionsFor,
  PAYMENTS_TAB,
  payment,
  later,
  openAlerts,
  bothLooking,
  did,
} from "./books-sync-fixtures.ts";

const REFUND = "55555555-5555-4555-8555-555555555555";

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
  describe("recording refunds", () => {
    async function refund(status: "created" | "processed") {
      await env.DB.prepare(
        `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, processed_at,
           updated_at)
         VALUES (?1, ?2, 'rfnd_test7', 3000000, ?3, 'normal', ?4, ?5, ?4)`,
      )
        .bind(
          REFUND,
          PAYMENT,
          status,
          "2026-09-20T21:00:00.000Z",
          status === "processed" ? "2026-09-21T05:00:00Z" : null,
        )
        .run();
    }

    const refundId = () =>
      env.DB.prepare("SELECT books_refund_id FROM refunds WHERE id = ?1")
        .bind(REFUND)
        .first<{ books_refund_id: string | null }>();

    it("records a processed refund of a recorded payment, from the refund account, once", async () => {
      await payment();
      await refund("processed");
      const books = createStubBooks();
      expect(await pass(books, "books-customer-9")).toEqual(did({ recorded: 1, refunded: 1 }));
      expect(books.made.refunds).toEqual([
        {
          paymentId: expect.stringMatching(/^stub-payment-/) as string,
          amount: 3000000,
          date: "2026-09-21",
          reference: "rfnd_test7",
          description: "Staging test: Razorpay refund rfnd_test7",
          fromAccountId: "bank-7",
        },
      ]);
      expect((await refundId())?.books_refund_id).toMatch(/^stub-refund-/);

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(books.made.refunds).toHaveLength(1);
    });

    it("finds by Razorpay's refund ID a refund Books recorded whose answer never came, rather than recording it twice", async () => {
      await payment();
      await refund("processed");
      const books = createStubBooks();
      books.loseAnswer("recordRefund");
      await pass(books, "books-customer-9");
      expect((await refundId())?.books_refund_id).toBeNull();

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(books.made.refunds).toHaveLength(1);
      const recorded = books.made.refunds[0];
      expect((await refundId())?.books_refund_id).toBe(await books.findRefund(recorded?.paymentId ?? "", "rfnd_test7"));
    });

    it("records none until Razorpay has processed it, or while no refund account is set", async () => {
      await payment();
      await refund("created");
      const books = createStubBooks();
      await pass(books, "books-customer-9");
      expect(books.made.refunds).toEqual([]);

      await env.DB.prepare("UPDATE refunds SET status = 'processed' WHERE id = ?1").bind(REFUND).run();
      await pass(books, "books-customer-9", NOW, { refundAccountId: null });
      expect(books.made.refunds).toEqual([]);
    });

    it("logs a refund Books refuses, and waits an hour to try again", async () => {
      await payment();
      await refund("processed");
      let refusing = true;
      const stub = createStubBooks();
      const books = {
        ...stub,
        recordRefund: (paymentId: string, details: Parameters<StubBooks["recordRefund"]>[1]) =>
          refusing
            ? Promise.reject(new ZohoError(400, "1", "Involved account types are not applicable"))
            : stub.recordRefund(paymentId, details),
      };
      const logs = captureLogs();
      await pass(books, "books-customer-9");
      expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "books_refund_refused", status: 400 }));
      expect(told).toEqual([
        `Books refused refund ${REFUND} (Razorpay rfnd_test7), saying "Involved account types are not applicable". It is asked again every hour. ${PAYMENTS_TAB}`,
      ]);

      refusing = false;
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS / 2));
      expect(books.made.refunds).toEqual([]);
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS + 1000));
      expect(books.made.refunds).toHaveLength(1);
      expect(await openAlerts()).toEqual({ n: 0 });
    });

    it("records a refund once when two passes run at the same time", async () => {
      await payment();
      await refund("processed");
      const stub = createStubBooks();
      await pass(stub, "books-customer-9", NOW, { refundAccountId: null });
      const looked = bothLooking();
      const books = {
        ...stub,
        findRefund: async (paymentId: string, reference: string) => {
          await looked.wait();
          return stub.findRefund(paymentId, reference);
        },
      };
      await Promise.all([pass(books, "books-customer-9"), pass(books, "books-customer-9")]);
      expect(looked.times()).toBe(1);
      expect(stub.made.refunds).toHaveLength(1);
    });
  });
});
