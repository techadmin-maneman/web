// Zoho Books, for the invoices and receipts a client sees in the app
// (docs/decisions/0032-fsm-mirror.md, 0044-payments-mirror.md). Documents are
// read from Books when a client opens one, never copied. Payments Razorpay
// took are recorded here, so Books issues their receipts. Clients become Books
// customers, keyed by our person ID, and the invoices we raise go on Books
// items. Callers use BooksProvider; only src/providers/books-zoho.ts knows
// Books' API.

import type { ZohoBooksSettings } from "../config/settings.ts";
import { createZohoBooks } from "./books-zoho.ts";
import { ProviderError } from "./provider-error.ts";
import type { ZohoRequesterDependencies } from "./zoho-http.ts";

/** The most pages of 200 items one read of Books' list takes. */
export { BOOKS_ITEM_PAGES } from "./books-zoho.ts";

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
    /** Taken off before tax; 0 for none. */
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
}

/** A service item to add, or to write over one. Its rate in paise. */
export interface BooksItemDetails {
  readonly name: string;
  readonly rate: number;
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
    discountInvoice: off,
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

// ---------------------------------------------------------------------------
// The stub
// ---------------------------------------------------------------------------

/** The smallest valid PDF: one blank page. The stub's every document. */
const BLANK_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

/** The records whose answer a test can lose: the record is made, and the call fails. */
export type StubBooksCreate = "recordPayment" | "recordRefund" | "upsertCustomer" | "createInvoice" | "createItem";

/** The calls a test can make fail, or have refused, once. */
export type StubBooksStep =
  StubBooksCreate | "updateCustomer" | "eraseCustomer" | "findInvoice" | "items" | "updateItem";

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
    /** Each customer written by person ID, in order, a second write of a person's as well. */
    readonly customers: NewBooksCustomer[];
    readonly customerUpdates: ({ customerId: string } & NewBooksCustomer)[];
    readonly erased: { customerId: string; outcome: BooksErasure }[];
    readonly invoices: NewBooksInvoice[];
    readonly itemsMade: BooksItemDetails[];
    readonly itemUpdates: ({ itemId: string } & BooksItemDetails)[];
  };
  /** Makes the next call of this kind fail, as an outage does. */
  failNext(step: StubBooksStep, message?: string): void;
  /** Makes the next call of this kind refused, as Books refuses: a 400 with its own code. */
  refuseNext(step: StubBooksStep, code?: string): void;
  /** Makes the next record of this kind take effect and then fail, as a call does whose answer never came. */
  loseAnswer(step: StubBooksCreate): void;
}

/**
 * What the stub's drafts that FSM raised total before a discount, in paise: the work order's figure, which the stub
 * cannot know. A discount then leaves that figure less the discount, as Books leaves it with GST at 0%. And the
 * items Books holds before a test adds any.
 */
interface StubBooksWorld {
  readonly draftTotal: number;
  readonly items?: readonly BooksItem[];
}

const blankPdf = () => ({
  body: new Response(BLANK_PDF).body ?? new ReadableStream<Uint8Array>(),
  contentType: "application/pdf" as const,
});

/** What a test asked of the stub's next calls: a failure once, or an answer lost once. */
function createStubControls() {
  const failures = new Map<StubBooksStep, Error>();
  const lostAnswers = new Set<StubBooksCreate>();
  return {
    failNext: (step: StubBooksStep, message = `the stub Books failed ${step}`) => {
      failures.set(step, new Error(message));
    },
    refuseNext: (step: StubBooksStep, code = "8") => {
      failures.set(step, new ProviderError(400, code, `the stub Books refused ${step}`));
    },
    loseAnswer: (step: StubBooksCreate) => {
      lostAnswers.add(step);
    },
    /** Fails once if the test asked this step to fail; a retry then succeeds. */
    check(step: StubBooksStep): Promise<void> {
      const failure = failures.get(step);
      if (failure === undefined) return Promise.resolve();
      failures.delete(step);
      return Promise.reject(failure);
    },
    /** A record that took effect answers, unless the test asked for its answer to be lost. */
    answer<T>(step: StubBooksCreate, made: T, id: string): Promise<T> {
      if (!lostAnswers.delete(step)) return Promise.resolve(made);
      return Promise.reject(new Error(`the stub Books made ${id}, and its answer never came`));
    },
  };
}

/**
 * Local and test stand-in: every invoice ID starting "stub-" exists, as a blank page, and so does every payment
 * it records. Its IDs are unique, as a new stub answers each local request. An invoice is a draft until it is
 * issued, as Books has it. A customer is found again by its person ID, an invoice by its reference.
 */
export function createStubBooks(world: StubBooksWorld = { draftTotal: 0 }): StubBooks {
  const made = {
    payments: [] as NewBooksPayment[],
    applied: [] as { paymentId: string; invoiceId: string; amount: number }[],
    refunds: [] as (NewBooksRefund & { paymentId: string })[],
    issued: [] as string[],
    discounts: [] as { invoiceId: string; amountOff: number }[],
    customers: [] as NewBooksCustomer[],
    customerUpdates: [] as ({ customerId: string } & NewBooksCustomer)[],
    erased: [] as { customerId: string; outcome: BooksErasure }[],
    invoices: [] as NewBooksInvoice[],
    itemsMade: [] as BooksItemDetails[],
    itemUpdates: [] as ({ itemId: string } & BooksItemDetails)[],
  };
  const controls = createStubControls();
  return {
    made,
    failNext: controls.failNext,
    refuseNext: controls.refuseNext,
    loseAnswer: controls.loseAnswer,
    ...stubDocumentsAndPayments(made, world, controls),
    ...stubCustomers(made, controls),
    ...stubItems(made, world, controls),
  };
}

type StubMade = StubBooks["made"];
type StubControls = ReturnType<typeof createStubControls>;
type CustomerCalls = "upsertCustomer" | "updateCustomer" | "eraseCustomer";
type ItemCalls = "items" | "createItem" | "updateItem";

function stubDocumentsAndPayments(made: StubMade, world: StubBooksWorld, controls: StubControls) {
  // What the stub recorded, by the keys a retry looks it up by.
  const paymentIds = new Map<string, string>();
  const refundIds = new Map<string, string>();
  const invoicesById = new Map<string, BooksInvoice>();
  const invoicesByReference = new Map<string, BooksInvoice>();
  const issuedOrDraft = (id: string) => (made.issued.includes(id) ? "sent" : "draft");

  const stub: Omit<BooksProvider, CustomerCalls | ItemCalls> = {
    findPayment: (customerId, reference) => Promise.resolve(paymentIds.get(`${customerId}:${reference}`) ?? null),
    async recordPayment(payment) {
      await controls.check("recordPayment");
      made.payments.push(payment);
      const id = `stub-payment-${crypto.randomUUID()}`;
      paymentIds.set(`${payment.customerId}:${payment.reference}`, id);
      return controls.answer("recordPayment", id, id);
    },
    receiptPdf: (paymentId) => Promise.resolve(paymentId.startsWith("stub-") ? blankPdf() : null),
    applyToInvoice: (paymentId, invoiceId, amount) => {
      made.applied.push({ paymentId, invoiceId, amount });
      return Promise.resolve();
    },
    findRefund: (paymentId, reference) => Promise.resolve(refundIds.get(`${paymentId}:${reference}`) ?? null),
    async recordRefund(paymentId, refund) {
      await controls.check("recordRefund");
      made.refunds.push({ ...refund, paymentId });
      const id = `stub-refund-${crypto.randomUUID()}`;
      refundIds.set(`${paymentId}:${refund.reference}`, id);
      return controls.answer("recordRefund", id, id);
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
    invoice: (id) => {
      const raised = invoicesById.get(id);
      if (raised !== undefined) return Promise.resolve({ ...raised, status: issuedOrDraft(id) });
      if (!id.startsWith("stub-")) return Promise.resolve(null);
      const number = `INV-${id.slice(5).padStart(6, "0")}`;
      return Promise.resolve({ id, number, date: "2026-09-22", total: 0, balance: 0, status: issuedOrDraft(id) });
    },
    invoicePdf: (id) => Promise.resolve(id.startsWith("stub-") ? blankPdf() : null),
    async findInvoice(reference) {
      await controls.check("findInvoice");
      const found = invoicesByReference.get(reference);
      return found === undefined ? null : { ...found, status: issuedOrDraft(found.id) };
    },
    // A draft's total is its rate less its discount, as Books works it out with GST at 0%.
    async createInvoice(invoice) {
      await controls.check("createInvoice");
      made.invoices.push(invoice);
      const id = `stub-invoice-${crypto.randomUUID()}`;
      const total = invoice.line.rate - invoice.line.discount;
      const number = `INV-${String(made.invoices.length).padStart(6, "0")}`;
      const raised = { id, number, date: invoice.date, total, balance: total, status: "draft" };
      invoicesById.set(id, raised);
      invoicesByReference.set(invoice.reference, raised);
      return controls.answer("createInvoice", raised, id);
    },
  };
  return stub;
}

function stubCustomers(made: StubMade, controls: StubControls) {
  const customerIds = new Map<string, string>();
  /** A customer a payment or an invoice names, which Books will not delete. */
  const named = (customerId: string) =>
    made.payments.some((payment) => payment.customerId === customerId) ||
    made.invoices.some((invoice) => invoice.customerId === customerId);

  const stub: Pick<BooksProvider, CustomerCalls> = {
    async upsertCustomer(customer) {
      await controls.check("upsertCustomer");
      made.customers.push(customer);
      const id = customerIds.get(customer.personId) ?? `stub-customer-${crypto.randomUUID()}`;
      customerIds.set(customer.personId, id);
      return controls.answer("upsertCustomer", id, id);
    },
    async updateCustomer(customerId, customer) {
      await controls.check("updateCustomer");
      made.customerUpdates.push({ customerId, ...customer });
    },
    async eraseCustomer(customerId) {
      await controls.check("eraseCustomer");
      const outcome: BooksErasure = named(customerId) ? "blanked" : "deleted";
      made.erased.push({ customerId, outcome });
      if (outcome === "deleted") forget(customerIds, customerId);
      return outcome;
    },
  };
  return stub;
}

/** Drops the person whose customer this is, so the next write for them adds a new one, as Books would. */
function forget(customerIds: Map<string, string>, customerId: string): void {
  for (const [personId, id] of customerIds) {
    if (id === customerId) customerIds.delete(personId);
  }
}

function stubItems(made: StubMade, world: StubBooksWorld, controls: StubControls) {
  const held: BooksItem[] = [...(world.items ?? [])];

  const stub: Pick<BooksProvider, ItemCalls> = {
    async items() {
      await controls.check("items");
      return held.map((item) => ({ ...item }));
    },
    async createItem(item) {
      await controls.check("createItem");
      made.itemsMade.push({ ...item });
      const id = `stub-item-${crypto.randomUUID()}`;
      held.push({ id, name: item.name, rate: item.rate, active: true });
      return controls.answer("createItem", id, id);
    },
    async updateItem(itemId, item) {
      await controls.check("updateItem");
      made.itemUpdates.push({ itemId, ...item });
      const index = held.findIndex((each) => each.id === itemId);
      const current = held[index];
      if (current !== undefined) held[index] = { ...current, name: item.name, rate: item.rate };
    },
  };
  return stub;
}
