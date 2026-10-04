// Payments and refunds recorded in Books, where the pass makes each client's Books customer itself. Every name and
// number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST, type GstRegistration } from "../../src/config/gst.ts";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { markCustomerChanged } from "../../src/domain/books-customers.ts";
import {
  CALLS_PER_CUSTOMER,
  CALLS_PER_RECORD,
  RECHECK_AFTER_MS,
  syncBooks,
  type BooksSyncOptions,
  type BooksSyncSummary,
} from "../../src/domain/books-sync.ts";
import { createCallBudget, type CallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks, type BooksInvoice, type BooksProvider, type StubBooks } from "../../src/providers/books.ts";
import { ZohoError } from "../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const REFUND = "55555555-5555-4555-8555-555555555555";

/** 1:30 am on 21 September in India. */
const TAKEN = "2026-09-20T20:00:00.000Z";

/** GST on, as the CA will have it: registered in Haryana. */
const REGISTERED: GstRegistration = { gstin: "06AAACM0000A1Z5", stateCode: "HR", sac: "999721" };

const sent = (overrides: Partial<BooksInvoice> = {}): BooksInvoice => ({
  id: "inv-41",
  number: "INV-000041",
  date: "2026-09-21",
  total: 3000000,
  balance: 3000000,
  status: "sent",
  reference: VISIT,
  ...overrides,
});

function booksWith(invoice: BooksInvoice | null): StubBooks {
  return { ...createStubBooks(), invoice: () => Promise.resolve(invoice) };
}

/** What the pass told ops. */
let told: string[];

const optionsFor = (overrides: Partial<BooksSyncOptions> = {}): BooksSyncOptions => ({
  refundAccountId: "bank-7",
  labelAsTest: true,
  gst: NO_GST,
  ...overrides,
});

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
  return syncBooks(env.DB, depsFor(books, now), optionsFor(overrides), now, createLogger(), budget);
}

const CLIENT_LINK = `http://ops.localhost:4323/clients/${PERSON}`;

async function payment(status = "captured", id = PAYMENT, capturedAt = TAKEN, kind = "visit") {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at, kind)
     VALUES (?1, ?7, ?2, ?3, ?8, 3000000, 'INR', 'upi', ?4, ?5, ?6, ?6, ?9)`,
  )
    .bind(
      id,
      PERSON,
      VISIT,
      status,
      status === "authorized" ? null : capturedAt,
      capturedAt,
      id === PAYMENT ? "MM-2026-0841" : "MM-2026-0842",
      id === PAYMENT ? "pay_test41" : "pay_test42",
      kind,
    )
    .run();
}

/** A second payment, taken an hour after the first. */
const SECOND = "66666666-6666-4666-8666-666666666666";
const secondPayment = (kind = "visit") => payment("captured", SECOND, "2026-09-20T21:00:00.000Z", kind);

async function invoiced(invoiceId: string | null) {
  await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = ?1 WHERE id = ?2").bind(invoiceId, VISIT).run();
}

const paymentRow = (id = PAYMENT) =>
  env.DB.prepare("SELECT books_payment_id, books_checked_at, books_applied_at FROM payments WHERE id = ?1")
    .bind(id)
    .first<{ books_payment_id: string | null; books_checked_at: string | null; books_applied_at: string | null }>();

const later = (ms: number) => new Date(NOW.getTime() + ms);

const openAlerts = () => env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();

/**
 * A look in Books that waits until a second pass could have made the same look, or a moment has passed: two passes
 * that both reached Books would then both record the same thing.
 */
function bothLooking() {
  let looks = 0;
  let release: () => void = () => undefined;
  const second = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    async wait(): Promise<void> {
      looks += 1;
      if (looks === 2) release();
      await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 50))]);
    },
    times: () => looks,
  };
}

/** A summary with only these counts. */
const did = (counts: Partial<BooksSyncSummary>): BooksSyncSummary => ({
  customers: 0,
  customersUpdated: 0,
  recorded: 0,
  applied: 0,
  refunded: 0,
  ...counts,
});

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
        `Books refused payment ${PAYMENT} (Razorpay pay_test41): 400 1002. It is asked again every hour. ${CLIENT_LINK}`,
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

    // MON-50, PLAT-31: a run that outlasts five minutes overlaps the next.
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

    // MON-15: what the invoice did not owe stayed in Books as the client's credit, and nobody was told.
    it("applies no more than the invoice still owes, and tells ops once of what is left over", async () => {
      await payment();
      await invoiced("inv-41");
      const books = booksWith(sent({ balance: 1200000 }));
      await pass(books, "books-customer-9");
      expect(books.made.applied[0]?.amount).toBe(1200000);
      expect(told).toEqual([
        expect.stringMatching(
          new RegExp(
            `^Payment ${PAYMENT} \\(Books stub-payment-.+\\) was Rs\\. 30000, and invoice inv-41 owed Rs\\. 12000 of ` +
              "it, so Rs\\. 18000 has nothing to be set against\\. It stays in Books as credit owed to the client",
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
      expect(told[0]).toContain(CLIENT_LINK);
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
        `Books refused payment ${PAYMENT} against invoice inv-41: 400 24016. Set it against the invoice in Books by hand. ${CLIENT_LINK}`,
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

  // MON-15 and the audit's M4: money kept on a visit no invoice will ever be raised for sat in Books as the client's
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
            `^Payment ${PAYMENT} \\(Books stub-payment-.+\\) has nothing to be set against: visit ${VISIT} was cancelled and Rs\\. 4000 of it kept\\.`,
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
        expect.stringContaining(`has nothing to be set against: visit ${VISIT} was a no-show and Rs. 4000 of it kept.`),
      ]);
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
              `moving visit ${VISIT}, and Rs\\. 30000 of it kept\\.`,
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
        `Books refused refund ${REFUND} (Razorpay rfnd_test7): 400 1. It is asked again every hour. ${CLIENT_LINK}`,
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

describe("the pass makes each client's Books customer", () => {
  const customerRow = () =>
    env.DB.prepare("SELECT books_customer_id, books_checked_at FROM people WHERE id = ?1")
      .bind(PERSON)
      .first<{ books_customer_id: string | null; books_checked_at: string | null }>();

  async function savedAddress(city: string, pincode: string) {
    await env.DB.prepare(
      `INSERT INTO addresses (id, person_id, created_at, line1, line2, locality, city, pincode, flat)
       VALUES ('address-1', ?1, ?2, '14 Aravali Road', NULL, 'DLF Phase 1', ?3, ?4, 'B-702')`,
    )
      .bind(PERSON, NOW.toISOString(), city, pincode)
      .run();
  }

  it("makes a paying client's customer, by their person ID, and records their payment against it in one pass", async () => {
    await payment();
    await savedAddress("Gurgaon", "122002");
    const books = createStubBooks();

    expect(await pass(books, null)).toEqual(did({ customers: 1, recorded: 1 }));
    expect(books.made.customers).toEqual([
      {
        personId: PERSON,
        name: "Rohit Malhotra",
        mobile: "+919810000001",
        email: null,
        stateCode: null,
        address: {
          street1: "B-702, 14 Aravali Road",
          street2: "DLF Phase 1",
          city: "Gurgaon",
          state: "Haryana",
          pincode: "122002",
        },
      },
    ]);
    const kept = (await customerRow())?.books_customer_id;
    expect(kept).toMatch(/^stub-customer-/);
    expect(books.made.payments).toEqual([expect.objectContaining({ customerId: kept, reference: "MM-2026-0841" })]);
  });

  it("makes the customer once across two passes", async () => {
    await payment();
    await secondPayment();
    const books = createStubBooks();
    await pass(books, null, NOW, {}, createCallBudget(CALLS_PER_CUSTOMER + CALLS_PER_RECORD));
    await pass(books, null, later(RECHECK_AFTER_MS * 2));
    expect(books.made.customers).toHaveLength(1);
    expect(books.made.payments).toHaveLength(2);
  });

  it("makes the customer of a client whose finished visit is still to be invoiced", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?1").bind(VISIT).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({ customers: 1 }));
  });

  it("makes none for a client whose only finished visit is free: a consultation, or a one visit they declined", async () => {
    await env.DB.prepare("UPDATE appointments SET status = 'completed', type = 'consultation' WHERE id = ?1")
      .bind(VISIT)
      .run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));

    await env.DB.prepare("UPDATE appointments SET type = 'first_fit', one_visit = 'declined' WHERE id = ?1")
      .bind(VISIT)
      .run();
    expect(await pass(books, null, later(RECHECK_AFTER_MS * 2))).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  it("makes none for a client with nothing to record", async () => {
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  it("never writes a client who has been erased, since their customer still holds their person ID", async () => {
    await payment();
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customers).toEqual([]);
  });

  // P1-20's contact half: once GST is on, Books splits the tax by the client's state.
  it("names the client's state as their place of contact once GST is on, and the state registered in without a city", async () => {
    await payment();
    await savedAddress("Delhi", "110017");
    const books = createStubBooks();
    await pass(books, null, NOW, { gst: REGISTERED });
    expect(books.made.customers[0]).toMatchObject({ stateCode: "DL", address: { city: "Delhi", state: "Delhi" } });

    await env.DB.batch([
      env.DB.prepare("DELETE FROM addresses"),
      env.DB.prepare("UPDATE appointments SET service_city = NULL"),
      env.DB.prepare("UPDATE people SET books_customer_id = NULL"),
      env.DB.prepare("UPDATE payments SET books_payment_id = NULL, books_checked_at = NULL"),
    ]);
    await pass(books, null, later(RECHECK_AFTER_MS * 2), { gst: REGISTERED });
    expect(books.made.customers[1]).toMatchObject({ stateCode: "HR", address: null });
  });

  it("takes the city of the client's latest visit where they have saved no address", async () => {
    await payment();
    await env.DB.prepare("UPDATE appointments SET service_city = 'Noida' WHERE id = ?1").bind(VISIT).run();
    const books = createStubBooks();
    await pass(books, null, NOW, { gst: REGISTERED });
    expect(books.made.customers[0]).toMatchObject({ stateCode: "UP", address: null });
  });

  it("tells ops of a customer Books refuses, and asks again an hour on", async () => {
    await payment();
    const books = createStubBooks();
    books.refuseNext("upsertCustomer", "4071");
    const logs = captureLogs();

    expect(await pass(books, null)).toEqual(did({}));
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "books_customer_refused", person_id: PERSON }),
    );
    expect(told).toEqual([
      `Books refused client ${PERSON}'s customer record: 400 4071. It is asked again every hour. ${CLIENT_LINK}`,
    ]);
    expect(await customerRow()).toEqual({ books_customer_id: null, books_checked_at: NOW.toISOString() });

    await pass(books, null, later(RECHECK_AFTER_MS / 2));
    expect(books.made.customers).toEqual([]);
    expect(await pass(books, null, later(RECHECK_AFTER_MS + 1000))).toEqual(did({ customers: 1, recorded: 1 }));
    expect(await openAlerts()).toEqual({ n: 0 });
  });

  it("finds the same customer when Books made it and its answer never came", async () => {
    await payment();
    const books = createStubBooks();
    books.loseAnswer("upsertCustomer");
    await pass(books, null);
    expect((await customerRow())?.books_customer_id).toBeNull();

    await pass(books, null, later(RECHECK_AFTER_MS + 1000));
    const [first, second] = books.made.customers;
    expect(second).toEqual(first);
    const sameCustomer = await books.upsertCustomer({
      personId: PERSON,
      name: "Rohit Malhotra",
      mobile: "+919810000001",
      email: null,
      stateCode: null,
      address: null,
    });
    expect((await customerRow())?.books_customer_id).toBe(sameCustomer);
  });

  it("stops when the cron run's calls are spent, mid-pass", async () => {
    const OTHER = "77777777-7777-4777-8777-777777777777";
    await env.DB.prepare(
      `INSERT INTO people (id, created_at, mobile_e164, name) VALUES (?1, ?2, '+919810000002', 'Kabir Anand')`,
    )
      .bind(OTHER, NOW.toISOString())
      .run();
    await payment();
    await env.DB.prepare(
      `INSERT INTO payments (id, reference, person_id, razorpay_payment_id, amount, currency, status, captured_at,
         created_at, updated_at)
       VALUES (?1, 'MM-2026-0843', ?2, 'pay_test43', 100000, 'INR', 'captured', ?3, ?3, ?3)`,
    )
      .bind(SECOND, OTHER, TAKEN)
      .run();
    const books = createStubBooks();
    const budget = createCallBudget(CALLS_PER_CUSTOMER);

    expect(await pass(books, null, NOW, {}, budget)).toEqual(did({ customers: 1 }));
    expect(books.made.customers).toHaveLength(1);
    expect(budget.ranOut()).toBe(true);
  });
});

describe("a client's new number or address reaches their Books customer", () => {
  beforeEach(async () => {
    await env.DB.prepare("UPDATE people SET books_customer_id = 'books-customer-9' WHERE id = ?1").bind(PERSON).run();
  });

  const changed = (at = NOW) => markCustomerChanged(env.DB, PERSON, at);

  const changedAt = async () =>
    (
      await env.DB.prepare("SELECT books_details_changed_at AS at FROM people WHERE id = ?1")
        .bind(PERSON)
        .first<{ at: string | null }>()
    )?.at;

  it("writes the client's details as they are now to their customer, once", async () => {
    await changed();
    await env.DB.prepare("UPDATE people SET mobile_e164 = '+919810000003' WHERE id = ?1").bind(PERSON).run();
    const books = createStubBooks();

    expect(await pass(books, null)).toEqual(did({ customersUpdated: 1 }));
    expect(books.made.customerUpdates).toEqual([
      {
        customerId: "books-customer-9",
        personId: PERSON,
        name: "Rohit Malhotra",
        mobile: "+919810000003",
        email: null,
        stateCode: null,
        address: null,
      },
    ]);
    expect(await changedAt()).toBeNull();

    expect(await pass(books, null, later(RECHECK_AFTER_MS * 2))).toEqual(did({}));
    expect(books.made.customerUpdates).toHaveLength(1);
  });

  it("writes a change made while Books was being written on the next pass", async () => {
    await changed();
    const stub = createStubBooks();
    const racing: BooksProvider = {
      ...stub,
      updateCustomer: async (customerId, customer) => {
        await changed(later(1000));
        await stub.updateCustomer(customerId, customer);
      },
    };

    await pass(racing, null);
    expect(await changedAt()).toBe(later(1000).toISOString());
    expect(await pass(stub, null, later(2000))).toEqual(did({ customersUpdated: 1 }));
    expect(await changedAt()).toBeNull();
  });

  it("never writes a client who has been erased, since the erasure blanks their customer", async () => {
    await changed();
    await env.DB.prepare("UPDATE people SET erased_at = ?1 WHERE id = ?2").bind(NOW.toISOString(), PERSON).run();
    const books = createStubBooks();
    expect(await pass(books, null)).toEqual(did({}));
    expect(books.made.customerUpdates).toEqual([]);
  });

  it("tells ops of an update Books refuses, and asks again an hour on", async () => {
    await changed();
    const books = createStubBooks();
    books.refuseNext("updateCustomer", "4071");
    const logs = captureLogs();

    expect(await pass(books, null)).toEqual(did({}));
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "books_customer_update_refused", person_id: PERSON }),
    );
    expect(told).toEqual([
      `Books refused client ${PERSON}'s new number or address: 400 4071. It is asked again every hour. ${CLIENT_LINK}`,
    ]);
    expect(await changedAt()).toBe(NOW.toISOString());

    expect(await pass(books, null, later(RECHECK_AFTER_MS / 2))).toEqual(did({}));
    expect(await pass(books, null, later(RECHECK_AFTER_MS + 1000))).toEqual(did({ customersUpdated: 1 }));
    expect(books.made.customerUpdates).toHaveLength(1);
    expect(await openAlerts()).toEqual({ n: 0 });
  });

  it("writes nothing once the cron run's calls are spent", async () => {
    await changed();
    const books = createStubBooks();
    expect(await pass(books, null, NOW, {}, createCallBudget(CALLS_PER_CUSTOMER - 1))).toEqual(did({}));
    expect(books.made.customerUpdates).toEqual([]);
    expect(await changedAt()).toBe(NOW.toISOString());
  });
});
