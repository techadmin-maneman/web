// Zoho Books, for the invoices and receipts a client sees in the app
// (docs/decisions/0032-fsm-mirror.md, 0044-payments-mirror.md). Documents are
// read from Books when a client opens one, never copied. Payments Razorpay
// took are recorded here, so Books issues their receipts. It shares the FSM
// client's Zoho token.
//
//   GET  /books/v3/invoices/{id}?organization_id=                     { invoice: {...} }
//   GET  /books/v3/invoices/{id}?organization_id=&accept=pdf          the PDF
//   POST /books/v3/invoices/{id}/status/sent?organization_id=         marks a draft sent
//   POST /books/v3/customerpayments?organization_id=                  { payment: { payment_id } }
//   GET  /books/v3/customerpayments/{id}?organization_id=&accept=pdf  the receipt
//   POST /books/v3/invoices/{id}/credits?organization_id=             a payment applied to an invoice
//   POST /books/v3/customerpayments/{id}/refunds?organization_id=     { payment_refund: { payment_refund_id } }

import { z } from "zod";
import type { ZohoFsmSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { createZohoFsmClient } from "./fsm-zoho.ts";
import { ZohoError } from "./zoho-http.ts";

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
  /** Null while Books has no such invoice, which the app shows as "Document unavailable". */
  invoicePdf(id: string): Promise<BooksPdf | null>;
  /** Records a payment; returns Books' ID for it. */
  recordPayment(payment: NewBooksPayment): Promise<string>;
  /** A recorded payment's receipt; null if Books has no such payment. */
  receiptPdf(paymentId: string): Promise<BooksPdf | null>;
  /** Applies a recorded payment, taken in advance, to the visit's invoice. */
  applyToInvoice(paymentId: string, invoiceId: string, amount: number): Promise<void>;
  /** Records money given back from a payment; returns Books' ID for the refund. */
  recordRefund(paymentId: string, refund: NewBooksRefund): Promise<string>;
}

interface Dependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

export function createBooksProvider(
  provider: string | undefined,
  settings: ZohoFsmSettings | null,
  deps: Dependencies,
): BooksProvider {
  if (provider === "zoho" && settings !== null && settings.booksOrgId !== null) {
    return createZohoBooks(settings, settings.booksOrgId, deps);
  }
  if (provider === "stub") return createStubBooks();
  const off = () => Promise.reject(new Error("Books is not connected here (BOOKS_PROVIDER is none)"));
  return {
    invoice: off,
    issueInvoice: off,
    invoicePdf: off,
    recordPayment: off,
    receiptPdf: off,
    applyToInvoice: off,
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

const Recorded = z.object({ payment: z.object({ payment_id: z.string() }) });
const Refunded = z.object({ payment_refund: z.object({ payment_refund_id: z.string() }) });

/** Paise as Books takes an amount: rupees. */
const rupees = (paise: number) => paise / 100;

function createZohoBooks(settings: ZohoFsmSettings, orgId: string, deps: Dependencies): BooksProvider {
  const request = createZohoFsmClient(settings, deps);
  const org = `organization_id=${encodeURIComponent(orgId)}`;
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
        const invoice = Invoice.parse(answer.invoice);
        return {
          id: invoice.invoice_id,
          number: invoice.invoice_number,
          date: invoice.date,
          total: Math.round(invoice.total * 100),
          balance: Math.round((invoice.balance ?? invoice.total) * 100),
          status: invoice.status,
        };
      }),

    async issueInvoice(id) {
      await request("issue_invoice", `/books/v3/invoices/${encodeURIComponent(id)}/status/sent?${org}`, {
        method: "POST",
        body: {},
      });
    },

    invoicePdf: (id) =>
      orNull(async () => {
        const response = await request("invoice_pdf", path(id, "&accept=pdf"));
        if (response.body === null) throw new ZohoError(response.status, "EMPTY_FILE", "the PDF came back empty");
        return { body: response.body, contentType: "application/pdf" as const };
      }),

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
  };
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
export function createStubBooks(): StubBooks {
  const made = {
    payments: [] as NewBooksPayment[],
    applied: [] as { paymentId: string; invoiceId: string; amount: number }[],
    refunds: [] as (NewBooksRefund & { paymentId: string })[],
    issued: [] as string[],
  };
  return {
    made,
    recordPayment: (payment) => {
      made.payments.push(payment);
      return Promise.resolve(`stub-payment-${crypto.randomUUID()}`);
    },
    receiptPdf: (paymentId) => Promise.resolve(paymentId.startsWith("stub-") ? blankPdf() : null),
    applyToInvoice: (paymentId, invoiceId, amount) => {
      made.applied.push({ paymentId, invoiceId, amount });
      return Promise.resolve();
    },
    recordRefund: (paymentId, refund) => {
      made.refunds.push({ ...refund, paymentId });
      return Promise.resolve(`stub-refund-${crypto.randomUUID()}`);
    },
    issueInvoice: (id) => {
      made.issued.push(id);
      return Promise.resolve();
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
