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
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import { NOW } from "../helpers.ts";
import { RECHECK_AFTER_MS } from "../../../src/domain/books/vendor-pass.ts";
import {
  PERSON,
  VISIT,
  PAYMENT,
  sent,
  booksWith,
  optionsFor,
  payment,
  SECOND,
  secondPayment,
  invoiced,
  paymentRow,
  later,
  openAlerts,
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
  // Money kept on a visit no invoice will ever be raised for sat in Books as the client's
  // credit, and only a late cancel's was told.
  describe("money kept, with nothing to set it against", () => {
    async function cancelled(kind: "cancelled" | "replaced", kept: number) {
      await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?1").bind(VISIT).run();
      await env.DB.prepare(
        `INSERT INTO visit_changes (id, appointment_id, person_id, kind, notice, was_start, refund_amount, kept_amount,
           payment_id, created_at)
         VALUES (?1, ?2, ?3, ?4, 'late', '2026-09-25T04:30:00.000Z', ?5, ?6, ?7, ?8)`,
      )
        .bind(crypto.randomUUID(), VISIT, PERSON, kind, 3000000 - kept, kept, PAYMENT, NOW.toISOString())
        .run();
    }

    /** The client was not home, and ops charged the no-show, keeping `kept` of the visit's payment. */
    async function chargedNoShow(kept: number) {
      const at = NOW.toISOString();
      await env.DB.batch([
        env.DB.prepare("UPDATE appointments SET status = 'terminated' WHERE id = ?1").bind(VISIT),
        env.DB.prepare(
          "INSERT INTO technicians (id, fsm_id, name, initials, active, updated_at) VALUES ('t1', 't1', 'Imran Qureshi', 'IQ', 1, ?1)",
        ).bind(at),
        env.DB.prepare(
          `INSERT INTO checkins (id, appointment_id, technician_id, at, radius_m, passed, created_at)
           VALUES ('checkin-1', ?1, 't1', ?2, 200, 1, ?2)`,
        ).bind(VISIT, at),
        env.DB.prepare(
          `INSERT INTO no_show_cases (id, checkin_id, appointment_id, wait_started_at, wait_ends_at, closed_at,
             decision, charge, kept_amount, refund_amount, created_at)
           VALUES ('case-1', 'checkin-1', ?1, ?2, ?2, ?2, 'charged', 'late_fee', ?3, ?4, ?2)`,
        ).bind(VISIT, at, kept, 3000000 - kept),
      ]);
    }

    it("of a visit cancelled late is told to ops once: no invoice will come to set it against", async () => {
      await payment();
      await cancelled("cancelled", 400000);
      const books = createStubBooks();

      await pass(books, "books-customer-9");
      expect(told).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Payment ${PAYMENT} \\(Books stub-payment-.+\\) has nothing to be set against: visit ${VISIT} was cancelled and Rs\\. 4,000 of it kept\\.`,
          ),
        ) as string,
      ]);
      expect((await paymentRow())?.books_applied_at).toBe(NOW.toISOString());

      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(told).toHaveLength(1);
    });

    it("is not told when the whole payment went back", async () => {
      await payment();
      await cancelled("cancelled", 0);
      await pass(createStubBooks(), "books-customer-9");
      expect(told).toEqual([]);
    });

    it("of a no-show ops charged is told to ops once", async () => {
      await payment();
      await chargedNoShow(400000);
      await pass(createStubBooks(), "books-customer-9");
      expect(told).toEqual([
        expect.stringContaining(
          `has nothing to be set against: visit ${VISIT} was a no-show and Rs. 4,000 of it kept.`,
        ),
      ]);
    });

    it("of a no-show charge refunded on the client's dispute is not told, though the refund has not landed", async () => {
      await payment();
      await chargedNoShow(400000);
      await env.DB.prepare(
        `INSERT INTO no_show_disputes (id, case_id, person_id, reason, created_at, ruling, ruled_by, ruled_at)
         VALUES ('dispute-1', 'case-1', ?1, 'Nobody rang the bell', ?2, 'refunded', 'ops@maneman.in', ?2)`,
      )
        .bind(PERSON, NOW.toISOString())
        .run();
      await pass(createStubBooks(), "books-customer-9");
      expect(told).toEqual([]);
    });

    it("closes what it told once the payment is refunded in full", async () => {
      await payment();
      await chargedNoShow(400000);
      const books = createStubBooks();
      await pass(books, "books-customer-9");
      expect(await openAlerts()).toEqual({ n: 1 });

      await env.DB.prepare("UPDATE payments SET refunded_amount = amount WHERE id = ?1").bind(PAYMENT).run();
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(await openAlerts()).toEqual({ n: 0 });
      expect(told).toHaveLength(1);
    });

    it("of a late fee is told to ops once, and never set against the visit's invoice", async () => {
      await payment();
      await secondPayment("late_fee");
      await invoiced("inv-41");
      const books = booksWith(sent({ balance: 6000000 }));

      await pass(books, "books-customer-9");
      expect(books.made.applied).toEqual([expect.objectContaining({ amount: 3000000 })]);
      expect(told).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Payment ${SECOND} \\(Books stub-payment-.+\\) has nothing to be set against: it is the late fee for ` +
              `moving visit ${VISIT}, and Rs\\. 30,000 of it kept\\.`,
          ),
        ) as string,
      ]);
      await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
      expect(told).toHaveLength(1);
    });

    it("is told once when two passes run at the same time", async () => {
      await payment();
      await cancelled("cancelled", 400000);
      const books = createStubBooks();
      await pass(books, "books-customer-9");
      await env.DB.prepare("UPDATE payments SET books_applied_at = NULL WHERE id = ?1").bind(PAYMENT).run();
      await env.DB.prepare("UPDATE alerts SET resolved_at = ?1").bind(NOW.toISOString()).run();
      told = [];

      const after = later(RECHECK_AFTER_MS * 2);
      await Promise.all([pass(books, "books-customer-9", after), pass(books, "books-customer-9", after)]);
      expect(told).toHaveLength(1);
    });
  });
});
