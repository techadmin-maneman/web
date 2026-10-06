// What the Books sync tests share (books-sync*.test.ts): a client's payments and invoice, a stub Books that answers
// with one, the sync's options, and what a pass did.

import { env } from "cloudflare:workers";
import { NO_GST } from "../../../src/config/gst.ts";
import { type BooksSyncSummary } from "../../../src/domain/books/books-sync.ts";
import type { BooksSyncOptions } from "../../../src/domain/books/books-pass.ts";
import { type BooksInvoice } from "../../../src/providers/books/index.ts";
import { createStubBooks, type StubBooks } from "../../../src/providers/books/stub.ts";
import { NOW } from "../helpers.ts";

export const PERSON = "11111111-1111-4111-8111-111111111111";

export const VISIT = "22222222-2222-4222-8222-222222222222";

export const PAYMENT = "33333333-3333-4333-8333-333333333333";

/** 1:30 am on 21 September in India. */
export const TAKEN = "2026-09-20T20:00:00.000Z";

export const sent = (overrides: Partial<BooksInvoice> = {}): BooksInvoice => ({
  id: "inv-41",
  number: "INV-000041",
  date: "2026-09-21",
  total: 3000000,
  balance: 3000000,
  status: "sent",
  reference: VISIT,
  ...overrides,
});

export function booksWith(invoice: BooksInvoice | null): StubBooks {
  return { ...createStubBooks(), invoice: () => Promise.resolve(invoice) };
}

export const optionsFor = (overrides: Partial<BooksSyncOptions> = {}): BooksSyncOptions => ({
  refundAccountId: "bank-7",
  labelAsTest: true,
  gst: NO_GST,
  ...overrides,
});

export const CLIENT_PAGE = `http://ops.localhost:4323/clients/${PERSON}`;

export const PAYMENTS_TAB = `${CLIENT_PAGE}/payments`;

export async function payment(status = "captured", id = PAYMENT, capturedAt = TAKEN, kind = "visit") {
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
export const SECOND = "66666666-6666-4666-8666-666666666666";

export const secondPayment = (kind = "visit") => payment("captured", SECOND, "2026-09-20T21:00:00.000Z", kind);

export async function invoiced(invoiceId: string | null) {
  await env.DB.prepare("UPDATE appointments SET fsm_invoice_id = ?1 WHERE id = ?2").bind(invoiceId, VISIT).run();
}

export const paymentRow = (id = PAYMENT) =>
  env.DB.prepare("SELECT books_payment_id, books_checked_at, books_applied_at FROM payments WHERE id = ?1")
    .bind(id)
    .first<{ books_payment_id: string | null; books_checked_at: string | null; books_applied_at: string | null }>();

export const later = (ms: number) => new Date(NOW.getTime() + ms);

export const openAlerts = () => env.DB.prepare("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL").first();

/**
 * A look in Books that waits until a second pass could have made the same look, or a moment has passed: two passes
 * that both reached Books would then both record the same thing.
 */
export function bothLooking() {
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
export const did = (counts: Partial<BooksSyncSummary>): BooksSyncSummary => ({
  customers: 0,
  customersUpdated: 0,
  recorded: 0,
  applied: 0,
  refunded: 0,
  ...counts,
});
