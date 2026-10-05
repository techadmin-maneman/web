// Zoho Books, for the invoices and receipts a client sees in the app
// (docs/decisions/0032-fsm-mirror.md, 0044-payments-mirror.md). Documents are
// read from Books when a client opens one, never copied. Payments Razorpay
// took are recorded here, so Books issues their receipts. Clients become Books
// customers, keyed by our person ID, and the invoices we raise go on Books
// items. Callers use BooksProvider; only src/providers/books/zoho.ts knows
// Books' API.

import type { ZohoBooksSettings } from "../../config/settings.ts";
import { createZohoBooks } from "./zoho.ts";
import type { ZohoRequesterDependencies } from "../zoho-http.ts";
import { createStubBooks } from "./stub.ts";

/** The most pages of 200 items one read of Books' list takes. */
export { BOOKS_ITEM_PAGES } from "./zoho.ts";

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
  /** The reference it was raised under: the appointment's ID on one we raised; null for none. */
  readonly reference: string | null;
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
  /** For Books' own list: Razorpay's payment ID. The receipt does not print it. */
  readonly description: string;
  /** What the money was for, which the receipt prints as its description of supply. */
  readonly supply: string;
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

/** A client as their Books customer holds them. */
export interface NewBooksCustomer {
  /** Ours, kept in the customer's "MM person ID", whose values Books keeps unique: what finds the customer again. */
  readonly personId: string;
  readonly name: string;
  /** E.164. */
  readonly mobile: string;
  readonly email: string | null;
  /**
   * The GST code of the client's state, e.g. HR, their place of contact. Null where the city is not one we know,
   * and while GST is off in Books, which then refuses one.
   */
  readonly stateCode: string | null;
  readonly address: {
    readonly street1: string;
    readonly street2: string | null;
    readonly city: string;
    readonly state: string | null;
    readonly pincode: string;
  } | null;
}

/** An invoice we raise for a visit: one line, on the visit's Books item. Amounts in paise. */
export interface NewBooksInvoice {
  readonly customerId: string;
  /** The appointment's ID: what finds the invoice again. */
  readonly reference: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** The GST code of the visit's state; null while GST is off in Books, which then refuses one. */
  readonly placeOfSupply: string | null;
  readonly line: {
    readonly itemId: string;
    readonly name: string;
    readonly description: string;
    /** The price book's price on the day, GST included. */
    readonly rate: number;
    /** Taken off the rate, GST included, before Books works out the tax; 0 for none. */
    readonly discount: number;
  };
}

/** An item in Books, which an invoice's line is on. */
export interface BooksItem {
  readonly id: string;
  readonly name: string;
  /** Its selling price, in paise. */
  readonly rate: number;
  readonly active: boolean;
  /** Its SAC code; null for none. */
  readonly sac: string | null;
}

/** A service item to add, or to write over one. Its rate in paise; a SAC code of null is left as Books has it. */
export interface BooksItemDetails {
  readonly name: string;
  readonly rate: number;
  readonly sac: string | null;
}

/** What erasing a customer left: nothing, or a blank, inactive customer a document or payment still names. */
export type BooksErasure = "deleted" | "blanked";

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
  /** The person's customer, added, or found by their person ID and brought up to date; Books' ID for it. */
  upsertCustomer(customer: NewBooksCustomer): Promise<string>;
  /** Writes a client's details as they now are over their customer. */
  updateCustomer(customerId: string, customer: NewBooksCustomer): Promise<void>;
  /**
   * Deletes the customer. Books keeps one a document or payment names, so that one is renamed "Erased client", its
   * contact person, number, e-mail and addresses cleared, and marked inactive. One call, or three for that one.
   */
  eraseCustomer(customerId: string): Promise<BooksErasure>;
  /** The invoice Books holds under our reference, whatever its status; null if it holds none. */
  findInvoice(reference: string): Promise<BooksInvoice | null>;
  /** Raises a draft; answers it with the total Books worked out. */
  createInvoice(invoice: NewBooksInvoice): Promise<BooksInvoice>;
  /** Every item, active or not: one call a page, BOOKS_ITEM_PAGES at most. */
  items(): Promise<BooksItem[]>;
  /** Adds a service item; returns Books' ID for it. */
  createItem(item: BooksItemDetails): Promise<string>;
  updateItem(itemId: string, item: BooksItemDetails): Promise<void>;
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
    invoicePdf: off,
    findPayment: off,
    recordPayment: off,
    receiptPdf: off,
    applyToInvoice: off,
    findRefund: off,
    recordRefund: off,
    upsertCustomer: off,
    updateCustomer: off,
    eraseCustomer: off,
    findInvoice: off,
    createInvoice: off,
    items: off,
    createItem: off,
    updateItem: off,
  };
}
