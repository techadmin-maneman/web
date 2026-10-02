// Zoho Books, for the invoices and receipts a client sees in the app
// (docs/decisions/0032-fsm-mirror.md, 0044-payments-mirror.md). Documents are
// read from Books when a client opens one, never copied. Payments Razorpay
// took are recorded here, so Books issues their receipts. Books has a Zoho
// client of its own.
//
//   GET  /books/v3/invoices/{id}?organization_id=                     { invoice: {...} }
//   GET  /books/v3/invoices/{id}?organization_id=&accept=pdf          the PDF
//   POST /books/v3/invoices/{id}/status/sent?organization_id=         marks a draft sent
//   POST /books/v3/customerpayments?organization_id=                  { payment: { payment_id } }
//   GET  /books/v3/customerpayments/{id}?organization_id=&accept=pdf  the receipt
//   POST /books/v3/invoices/{id}/credits?organization_id=             a payment applied to an invoice
//   POST /books/v3/customerpayments/{id}/refunds?organization_id=     { payment_refund: { payment_refund_id } }
//
// Two reads look for a record by our reference before it is made, so a try
// whose answer was lost is not recorded twice (docs/decisions/0070-vendor-correctness.md).
// They follow Books' API documentation and have not yet been tried on the org:
//
//   GET  /books/v3/customerpayments?organization_id=&customer_id=&reference_number=
//                                                                     { customerpayments: [{ payment_id, reference_number }] }
//   GET  /books/v3/customerpayments/{id}/refunds?organization_id=     { payment_refunds: [{ payment_refund_id, reference_number }] }
//
// A discount code's line discount on a draft before it is sent (docs/decisions/0108-discount-codes.md) follows the
// same documentation and has not been tried on the org either (docs/open-points.md, item 181):
//
//   PUT  /books/v3/invoices/{id}?organization_id=                     { invoice: {...} }, with every line, the
//                                                                     visit's line carrying the discount in rupees,
//                                                                     discount_type item_level, before tax

import { z } from "zod";
import type { ZohoBooksSettings } from "../config/settings.ts";
import { createZohoRequester, ZohoError, type ZohoRequesterDependencies } from "./zoho-http.ts";

export interface BooksInvoice {
  readonly id: string;
  /** Books' own number, e.g. "INV-000041". */
  readonly number: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** In paise. */
  readonly total: number;
  /** In paise: what is still owed on it. */
  readonly balance: number;
  /** Books' status word: draft, sent, paid, void and so on. */
  readonly status: string;
}

export interface BooksPdf {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: "application/pdf";
}

/** A payment Razorpay took, to record against the client's customer record in Books. Amounts in paise. */
export interface NewBooksPayment {
  readonly customerId: string;
  readonly amount: number;
  /** India's calendar date it was taken. */
  readonly date: string;
  /** Ours, e.g. MM-2026-0841: the receipt's reference. */
  readonly reference: string;
  readonly description: string;
}

/** Money given back from a recorded payment, from the account Razorpay settles into. Amounts in paise. */
export interface NewBooksRefund {
  readonly amount: number;
  readonly date: string;
  /** Razorpay's refund ID. */
  readonly reference: string;
  readonly description: string;
  readonly fromAccountId: string;
}

export interface BooksProvider {
  invoice(id: string): Promise<BooksInvoice | null>;
  /**
   * Marks a draft sent, which is what makes it a valid tax invoice
   * (ADR 0056). Only `raiseInvoices` calls it, and only for an invoice it has
   * just raised: an issued invoice can be undone only with a credit note.
   */
  issueInvoice(id: string): Promise<void>;
  /**
   * Takes a discount code's amount, in paise, off a draft's visit line before tax, so the invoice shows the price,
   * the discount and the total; answers the invoice as it now stands. Only `raiseInvoices` calls it, on an invoice it
   * has just raised and not yet sent.
   */
  discountInvoice(id: string, amountOff: number): Promise<BooksInvoice>;
  /** Null while Books has no such invoice, which the app shows as "Document unavailable". */
  invoicePdf(id: string): Promise<BooksPdf | null>;
  /** The payment Books holds for this customer under our reference; null if it holds none. */
  findPayment(customerId: string, reference: string): Promise<string | null>;
  /** Records a payment; returns Books' ID for it. */
  recordPayment(payment: NewBooksPayment): Promise<string>;
  /** A recorded payment's receipt; null if Books has no such payment. */
  receiptPdf(paymentId: string): Promise<BooksPdf | null>;
  /** Applies a recorded payment, taken in advance, to the visit's invoice. */
  applyToInvoice(paymentId: string, invoiceId: string, amount: number): Promise<void>;
  /** The refund of a recorded payment Books holds under this reference, Razorpay's refund ID; null if none. */
  findRefund(paymentId: string, reference: string): Promise<string | null>;
  /** Records money given back from a payment; returns Books' ID for the refund. */
  recordRefund(paymentId: string, refund: NewBooksRefund): Promise<string>;
}

export function createBooksProvider(
  provider: string | undefined,
  settings: ZohoBooksSettings | null,
  deps: ZohoRequesterDependencies,
): BooksProvider {
  if (provider === "zoho" && settings !== null) return createZohoBooks(settings, deps);
  if (provider === "stub") return createStubBooks();
  const off = () => Promise.reject(new Error("Books is not connected here (BOOKS_PROVIDER is none)"));
  return {
    invoice: off,
    issueInvoice: off,
    discountInvoice: off,
    invoicePdf: off,
    findPayment: off,
    recordPayment: off,
    receiptPdf: off,
    applyToInvoice: off,
    findRefund: off,
    recordRefund: off,
  };
}

const Invoice = z.object({
  invoice_id: z.string(),
  invoice_number: z.string(),
  date: z.string(),
  total: z.number(),
  balance: z.number().optional(),
  status: z.string(),
});

/** A draft with its lines, as a discount is written onto it: each line is sent back, or Books removes it. */
const InvoiceWithLines = Invoice.extend({
  customer_id: z.string(),
  line_items: z
    .array(
      z.looseObject({
        line_item_id: z.string(),
        rate: z.number(),
        quantity: z.number(),
        discount: z.union([z.number(), z.string()]).optional(),
      }),
    )
    .min(1),
});

type BooksLine = z.infer<typeof InvoiceWithLines>["line_items"][number];

/** The visit's line, which a discount comes off: the dearest, since a visit's work order bills its service first. */
const visitLine = (lines: readonly BooksLine[]): BooksLine | undefined =>
  lines.reduce<BooksLine | undefined>(
    (dearest, line) =>
      dearest === undefined || line.rate * line.quantity > dearest.rate * dearest.quantity ? line : dearest,
    undefined,
  );

const Recorded = z.object({ payment: z.object({ payment_id: z.string() }) });
const Refunded = z.object({ payment_refund: z.object({ payment_refund_id: z.string() }) });

/** The payments a search found. Books may match a reference loosely, so each is compared again here. */
const PaymentsFound = z.object({
  customerpayments: z.array(z.object({ payment_id: z.string(), reference_number: z.string().nullish() })).default([]),
});
const RefundsFound = z.object({
  payment_refunds: z
    .array(z.object({ payment_refund_id: z.string(), reference_number: z.string().nullish() }))
    .default([]),
});

/** Paise as Books takes an amount: rupees. */
const rupees = (paise: number) => paise / 100;

/** An invoice as Books gives it, its amounts in paise. */
const booksInvoiceOf = (invoice: z.infer<typeof Invoice>): BooksInvoice => ({
  id: invoice.invoice_id,
  number: invoice.invoice_number,
  date: invoice.date,
  total: Math.round(invoice.total * 100),
  balance: Math.round((invoice.balance ?? invoice.total) * 100),
  status: invoice.status,
});

function createZohoBooks(settings: ZohoBooksSettings, deps: ZohoRequesterDependencies): BooksProvider {
  const request = createZohoRequester("books", settings, deps);
  const org = `organization_id=${encodeURIComponent(settings.orgId)}`;
  const path = (id: string, extra = "") => `/books/v3/invoices/${encodeURIComponent(id)}?${org}${extra}`;
  const payments = (id?: string, tail = "") =>
    `/books/v3/customerpayments${id === undefined ? "" : `/${encodeURIComponent(id)}`}${tail}?${org}`;

  /** Books answers 404 for an invoice it does not have; that is "unavailable", not a failure. */
  async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ZohoError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    invoice: (id) =>
      orNull(async () => {
        const answer = await (await request("invoice", path(id))).json<{ invoice?: unknown }>();
        return booksInvoiceOf(Invoice.parse(answer.invoice));
      }),

    async issueInvoice(id) {
      await request("issue_invoice", `/books/v3/invoices/${encodeURIComponent(id)}/status/sent?${org}`, {
        method: "POST",
        body: {},
      });
    },

    async discountInvoice(id, amountOff) {
      const read = await (await request("invoice", path(id))).json<{ invoice?: unknown }>();
      const draft = InvoiceWithLines.parse(read.invoice);
      const discounted = visitLine(draft.line_items);
      const body = {
        customer_id: draft.customer_id,
        discount_type: "item_level",
        is_discount_before_tax: true,
        line_items: draft.line_items.map((line) =>
          line === discounted ? { ...line, discount: rupees(amountOff) } : line,
        ),
      };
      const written = await (
        await request("discount_invoice", path(id), { method: "PUT", body })
      ).json<{
        invoice?: unknown;
      }>();
      return booksInvoiceOf(Invoice.parse(written.invoice));
    },

    invoicePdf: (id) =>
      orNull(async () => {
        const response = await request("invoice_pdf", path(id, "&accept=pdf"));
        if (response.body === null) throw new ZohoError(response.status, "EMPTY_FILE", "the PDF came back empty");
        return { body: response.body, contentType: "application/pdf" as const };
      }),

    async findPayment(customerId, reference) {
      const query = `&customer_id=${encodeURIComponent(customerId)}&reference_number=${encodeURIComponent(reference)}`;
      const response = await request("find_payment", `${payments()}${query}`);
      const found = PaymentsFound.parse(await response.json()).customerpayments;
      return found.find((each) => each.reference_number === reference)?.payment_id ?? null;
    },

    async recordPayment(payment) {
      const response = await request("record_payment", payments(), {
        method: "POST",
        body: {
          customer_id: payment.customerId,
          payment_mode: "Razorpay",
          amount: rupees(payment.amount),
          date: payment.date,
          reference_number: payment.reference,
          description: payment.description,
        },
      });
      return Recorded.parse(await response.json()).payment.payment_id;
    },

    receiptPdf: (paymentId) =>
      orNull(async () => {
        const response = await request("receipt_pdf", `${payments(paymentId)}&accept=pdf`);
        if (response.body === null) throw new ZohoError(response.status, "EMPTY_FILE", "the PDF came back empty");
        return { body: response.body, contentType: "application/pdf" as const };
      }),

    async applyToInvoice(paymentId, invoiceId, amount) {
      await request("apply_payment", `/books/v3/invoices/${encodeURIComponent(invoiceId)}/credits?${org}`, {
        method: "POST",
        body: { invoice_payments: [{ payment_id: paymentId, amount_applied: rupees(amount) }] },
      });
    },

    async findRefund(paymentId, reference) {
      const response = await request("find_refund", payments(paymentId, "/refunds"));
      const found = RefundsFound.parse(await response.json()).payment_refunds;
      return found.find((each) => each.reference_number === reference)?.payment_refund_id ?? null;
    },

    async recordRefund(paymentId, refund) {
      const response = await request("record_refund", payments(paymentId, "/refunds"), {
        method: "POST",
        body: {
          date: refund.date,
          refund_mode: "Razorpay",
          amount: rupees(refund.amount),
          from_account_id: refund.fromAccountId,
          reference_number: refund.reference,
          description: refund.description,
        },
      });
      return Refunded.parse(await response.json()).payment_refund.payment_refund_id;
    },
  };
}

/** The smallest valid PDF: one blank page. The stub's every document. */
const BLANK_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

/** The stub, and what was written to it, for tests to read. */
export interface StubBooks extends BooksProvider {
  readonly made: {
    readonly payments: NewBooksPayment[];
    readonly applied: { paymentId: string; invoiceId: string; amount: number }[];
    readonly refunds: (NewBooksRefund & { paymentId: string })[];
    /** The invoices marked sent, in the order they were. */
    readonly issued: string[];
    /** The discounts written onto drafts, in paise before GST. */
    readonly discounts: { invoiceId: string; amountOff: number }[];
  };
  /** Makes the next record of this kind take effect and then fail, as a call does whose answer never came. */
  loseAnswer(step: "recordPayment" | "recordRefund"): void;
}

/**
 * What the stub's drafts total before a discount, in paise: the work order's figure, which the stub cannot know, as
 * FSM raised the draft. A discount then leaves that figure less the discount, as Books leaves it with GST at 0%.
 */
interface StubBooksWorld {
  readonly draftTotal: number;
}

const blankPdf = () => ({
  body: new Response(BLANK_PDF).body ?? new ReadableStream<Uint8Array>(),
  contentType: "application/pdf" as const,
});

/**
 * Local and test stand-in: every invoice ID starting "stub-" exists, as a blank page, and so does every payment
 * it records. Its IDs are unique, as a new stub answers each local request. An invoice is a draft until it is
 * issued, as Books has it.
 */
export function createStubBooks(world: StubBooksWorld = { draftTotal: 0 }): StubBooks {
  const made = {
    payments: [] as NewBooksPayment[],
    applied: [] as { paymentId: string; invoiceId: string; amount: number }[],
    refunds: [] as (NewBooksRefund & { paymentId: string })[],
    issued: [] as string[],
    discounts: [] as { invoiceId: string; amountOff: number }[],
  };
  // What the stub recorded, by the keys a retry looks it up by.
  const paymentIds = new Map<string, string>();
  const refundIds = new Map<string, string>();
  const lostAnswers = new Set<"recordPayment" | "recordRefund">();
  /** A record that took effect answers with its ID, unless the test asked for its answer to be lost. */
  const answer = (step: "recordPayment" | "recordRefund", id: string): Promise<string> =>
    lostAnswers.delete(step)
      ? Promise.reject(new Error(`the stub Books recorded ${id}, and its answer never came`))
      : Promise.resolve(id);

  return {
    made,
    loseAnswer: (step) => {
      lostAnswers.add(step);
    },
    findPayment: (customerId, reference) => Promise.resolve(paymentIds.get(`${customerId}:${reference}`) ?? null),
    recordPayment: (payment) => {
      made.payments.push(payment);
      const id = `stub-payment-${crypto.randomUUID()}`;
      paymentIds.set(`${payment.customerId}:${payment.reference}`, id);
      return answer("recordPayment", id);
    },
    receiptPdf: (paymentId) => Promise.resolve(paymentId.startsWith("stub-") ? blankPdf() : null),
    applyToInvoice: (paymentId, invoiceId, amount) => {
      made.applied.push({ paymentId, invoiceId, amount });
      return Promise.resolve();
    },
    findRefund: (paymentId, reference) => Promise.resolve(refundIds.get(`${paymentId}:${reference}`) ?? null),
    recordRefund: (paymentId, refund) => {
      made.refunds.push({ ...refund, paymentId });
      const id = `stub-refund-${crypto.randomUUID()}`;
      refundIds.set(`${paymentId}:${refund.reference}`, id);
      return answer("recordRefund", id);
    },
    issueInvoice: (id) => {
      made.issued.push(id);
      return Promise.resolve();
    },
    discountInvoice: (id, amountOff) => {
      made.discounts.push({ invoiceId: id, amountOff });
      const total = world.draftTotal - amountOff;
      return Promise.resolve({ id, number: "INV-000001", date: "2026-09-22", total, balance: total, status: "draft" });
    },
    invoice: (id) =>
      Promise.resolve(
        id.startsWith("stub-")
          ? {
              id,
              number: `INV-${id.slice(5).padStart(6, "0")}`,
              date: "2026-09-22",
              total: 0,
              balance: 0,
              status: made.issued.includes(id) ? "sent" : "draft",
            }
          : null,
      ),
    invoicePdf: (id) => Promise.resolve(id.startsWith("stub-") ? blankPdf() : null),
  };
}
