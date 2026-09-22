// Payments and refunds recorded in Books. Every name and number here is made up.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RECHECK_AFTER_MS, syncBooks, type BooksSyncOptions } from "../../src/domain/books-sync.ts";
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

function pass(books: StubBooks, booksCustomerId: string | null, now = NOW, options = STAGING) {
  const fsm = createStubFsm({ ...EMPTY_FSM, contacts: [contact(booksCustomerId)] });
  return syncBooks(env.DB, fsm, books, options, now, createLogger());
}

async function payment(status = "captured") {
  await env.DB.prepare(
    `INSERT INTO payments (id, reference, person_id, appointment_id, razorpay_payment_id, amount, currency, method,
       status, captured_at, created_at, updated_at)
     VALUES (?1, 'MM-2026-0841', ?2, ?3, 'pay_test41', 3000000, 'INR', 'upi', ?4, ?5, ?6, ?6)`,
  )
    .bind(PAYMENT, PERSON, VISIT, status, status === "authorized" ? null : TAKEN, TAKEN)
    .run();
}

async function invoiced(invoiceId: string | null) {
  await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = ?1 WHERE id = ?2").bind(invoiceId, VISIT).run();
}

const paymentRow = () =>
  env.DB.prepare("SELECT books_payment_id, books_checked_at, books_applied_at FROM payments WHERE id = ?1")
    .bind(PAYMENT)
    .first<{ books_payment_id: string | null; books_checked_at: string | null; books_applied_at: string | null }>();

const later = (ms: number) => new Date(NOW.getTime() + ms);

beforeEach(async () => {
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

  it("logs a payment Books refuses, and waits an hour to try again", async () => {
    await payment();
    const books = {
      ...createStubBooks(),
      recordPayment: () => Promise.reject(new ZohoError(400, "1002", "customer inactive")),
    };
    const logs = captureLogs();
    await pass(books, "books-customer-9");
    expect(logs.lines()).toContainEqual(expect.objectContaining({ event: "books_payment_refused", status: 400 }));
    expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: NOW.toISOString() });
  });

  it("lets any other failure through, for the cron to log, and changes nothing", async () => {
    await payment();
    const books = {
      ...createStubBooks(),
      recordPayment: () => Promise.reject(new ZohoError(503, "UNAVAILABLE", "try later")),
    };
    await expect(pass(books, "books-customer-9")).rejects.toThrow(/503/);
    expect(await paymentRow()).toMatchObject({ books_payment_id: null, books_checked_at: null });
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

  it("logs a payment Books will not apply, and does not try again", async () => {
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
  });

  it("waits for the invoice", async () => {
    await payment();
    const books = booksWith(sent());
    await pass(books, "books-customer-9");
    expect(books.made.applied).toEqual([]);
    expect((await paymentRow())?.books_applied_at).toBeNull();
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

    refusing = false;
    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS / 2));
    expect(books.made.refunds).toEqual([]);
    await pass(books, "books-customer-9", later(RECHECK_AFTER_MS + 1000));
    expect(books.made.refunds).toHaveLength(1);
  });
});
