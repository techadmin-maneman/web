// Payments and refunds recorded in Books. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createAlertOnce, createResolveAlert } from "../../src/domain/alerts.ts";
import { CALLS_PER_RECORD, RECHECK_AFTER_MS, syncBooks, type BooksSyncOptions } from "../../src/domain/books-sync.ts";
import { createCallBudget, type CallBudget } from "../../src/lib/call-budget.ts";
import { createLogger } from "../../src/log.ts";
import { createStubBooks, type BooksInvoice, type StubBooks } from "../../src/providers/books.ts";
import { createStubFsm, EMPTY_FSM, type FsmContact } from "../../src/providers/fsm.ts";
import { ZohoError } from "../../src/providers/zoho-http.ts";
import { captureLogs, NOW } from "./helpers.ts";

const PERSON = "11111111-1111-4111-8111-111111111111";
const VISIT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const REFUND = "55555555-5555-4555-8555-555555555555";

/** 1:30 am on 21 September in India. */
const TAKEN = "2026-09-20T20:00:00.000Z";

const STAGING: BooksSyncOptions = { refundAccountId: "bank-7", labelAsTest: true };

const contact = (booksCustomerId: string | null): FsmContact => ({
  id: "fsm-contact-1",
  name: "Rohit Malhotra",
  mobile: "+919810000001",
  email: null,
  booksCustomerId,
});

const sent = (overrides: Partial<BooksInvoice> = {}): BooksInvoice => ({
  id: "inv-41",
  number: "INV-000041",
  date: "2026-09-21",
  total: 3000000,
  balance: 3000000,
  status: "sent",
  ...overrides,
});

function booksWith(invoice: BooksInvoice | null): StubBooks {
  return { ...createStubBooks(), invoice: () => Promise.resolve(invoice) };
}

/** What the pass told ops. */
let told: string[];

function pass(
  books: StubBooks,
  booksCustomerId: string | null,
  now = NOW,
  options = STAGING,
  budget: CallBudget = createCallBudget(Infinity),
) {
  const fsm = createStubFsm({ ...EMPTY_FSM, contacts: [contact(booksCustomerId)] });
  const alert = (message: string) => {
    told.push(message);
    return Promise.resolve();
  };
  const alertOnce = createAlertOnce({ db: env.DB, alert, now: () => now, environment: "local", log: createLogger() });
  const resolveAlert = createResolveAlert({ db: env.DB, now: () => now });
  return syncBooks(env.DB, { fsm, books, alertOnce, resolveAlert }, options, now, createLogger(), budget);
}

const CLIENT_LINK = `http://ops.localhost:4323/clients/${PERSON}`;

async function payment(status = "captured", id = PAYMENT, capturedAt = TAKEN) {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, ?7, ?2, ?3, ?8, 3000000, 'INR', 'upi', ?4, ?5, ?6, ?6)`,
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
    )
    .run();
}

/** A second payment, taken an hour after the first. */
const SECOND = "66666666-6666-4666-8666-666666666666";
const secondPayment = () => payment("captured", SECOND, "2026-09-20T21:00:00.000Z");

async function invoiced(invoiceId: string | null) {
  await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = ?1 WHERE id = ?2").bind(invoiceId, VISIT).run();
}

const paymentRow = () =>
  env.DB.prepare("SELECT books_payment_id, books_checked_at, books_applied_at FROM payments WHERE id = ?1")
    .bind(PAYMENT)
    .first<{ books_payment_id: string | null; books_checked_at: string | null; books_applied_at: string | null }>();

const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
  told = [];
  await env.DB.prepare(
    `INSERT INTO people (id, created_at, mobile_e164, name, fsm_contact_id)
     VALUES (?1, ?2, '+919810000001', 'Rohit Malhotra', 'fsm-contact-1')`,
  )
    .bind(PERSON, NOW.toISOString())
    .run();
  await env.DB.prepare(
    `INSERT INTO appointments (id, fsm_id, person_id, type, status, fsm_status, window_start, window_end,
       fsm_modified_at, synced_at)
     VALUES (?1, 'fsm-visit-1', ?2, 'first_fit', 'scheduled', 'Scheduled', '2026-09-25T04:30:00.000Z',
       '2026-09-25T07:30:00.000Z', ?3, ?3)`,
  )
    .bind(VISIT, PERSON, NOW.toISOString())
    .run();
});

describe("recording payments", () => {
  it("records a captured payment against the client's Books record, once, labelled as a test on staging", async () => {
    await payment();
    const books = createStubBooks();
    expect(await pass(books, "books-customer-9")).toEqual({ recorded: 1, applied: 0, refunded: 0 });
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

  it("gives production's no label", async () => {
    await payment();
    const books = createStubBooks();
    await pass(books, "books-customer-9", NOW, { refundAccountId: null, labelAsTest: false });
    expect(books.made.payments[0]?.description).toBe("Razorpay payment pay_test41");
  });

  it("waits an hour to ask again while the client has not reached Books", async () => {
    await payment();
    const books = createStubBooks();
    await pass(books, null);
    expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: NOW.toISOString() });

    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS / 2));
    expect(books.made.payments).toEqual([]);

    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS + 1000));
    expect(books.made.payments).toHaveLength(1);
    expect((await paymentRow())?.books_checked_at).toBeNull();
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

    expect(await pass(books, "books-customer-9")).toEqual({ recorded: 1, applied: 0, refunded: 0 });
    expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: NOW.toISOString() });
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ event: "books_payment_failed", payment_id: PAYMENT }),
    );
    expect(told).toEqual([]);
  });

  it("carries on past a client FSM would not read", async () => {
    await payment();
    const books = createStubBooks();
    const fsm = { ...createStubFsm(EMPTY_FSM), contact: () => Promise.reject(new Error("FSM timed out")) };
    const alertOnce = createAlertOnce({
      db: env.DB,
      alert: () => Promise.resolve(),
      now: () => NOW,
      environment: "local",
      log: createLogger(),
    });
    const resolveAlert = createResolveAlert({ db: env.DB, now: () => NOW });
    const deps = { fsm, books, alertOnce, resolveAlert };

    expect(await syncBooks(env.DB, deps, STAGING, NOW, createLogger(), createCallBudget(Infinity))).toEqual({
      recorded: 0,
      applied: 0,
      refunded: 0,
    });
    expect((await paymentRow())?.books_checked_at).toBe(NOW.toISOString());
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
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });
});

describe("the pass's outside calls", () => {
  it("handles only the records the cron run can pay for; the rest are the next run's", async () => {
    await payment();
    await secondPayment();
    const books = createStubBooks();

    expect(await pass(books, "books-customer-9", NOW, STAGING, createCallBudget(CALLS_PER_RECORD))).toEqual({
      recorded: 1,
      applied: 0,
      refunded: 0,
    });
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
    expect(await pass(books, "books-customer-9")).toEqual({ recorded: 1, applied: 1, refunded: 0 });
    expect(books.made.applied).toEqual([
      { paymentId: expect.stringMatching(/^stub-payment-/) as string, invoiceId: "inv-41", amount: 3000000 },
    ]);
    expect((await paymentRow())?.books_applied_at).toBe(NOW.toISOString());

    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS * 2));
    expect(books.made.applied).toHaveLength(1);
  });

  it("applies no more than the invoice still owes", async () => {
    await payment();
    await invoiced("inv-41");
    const books = booksWith(sent({ balance: 1200000 }));
    await pass(books, "books-customer-9");
    expect(books.made.applied[0]?.amount).toBe(1200000);
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

describe("a kept charge", () => {
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
});

describe("recording refunds", () => {
  async function refund(status: "created" | "processed") {
    await env.DB.prepare(
      `INSERT INTO refunds (id, payment_id, razorpay_refund_id, amount, status, speed, created_at, processed_at,
         updated_at)
       VALUES (?1, ?2, 'rfnd_test7', 3000000, ?3, 'normal', ?4, ?5, ?4)`,
    )
      .bind(REFUND, PAYMENT, status, "2026-09-20T21:00:00.000Z", status === "processed" ? "2026-09-21T05:00:00Z" : null)
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
    expect(await pass(books, "books-customer-9")).toEqual({ recorded: 1, applied: 0, refunded: 1 });
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

  it("records none until Razorpay has processed it, or while no refund account is set", async () => {
    await payment();
    await refund("created");
    const books = createStubBooks();
    await pass(books, "books-customer-9");
    expect(books.made.refunds).toEqual([]);

    await env.DB.prepare("UPDATE refunds SET status = 'processed' WHERE id = ?1").bind(REFUND).run();
    await pass(books, "books-customer-9", NOW, { refundAccountId: null, labelAsTest: true });
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
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();
    expect(open).toEqual({ n: 0 });
  });
});
