// Books' local and test stand-in (./index.ts chooses it): it records what it was asked, and a test can make any
// call fail or never answer.

import { ProviderError } from "../provider-error.ts";
import type {
  BooksInvoice,
  NewBooksPayment,
  NewBooksRefund,
  NewBooksCustomer,
  NewBooksInvoice,
  BooksItem,
  BooksItemDetails,
  BooksErasure,
  BooksProvider,
} from "./index.ts";

/** The smallest valid PDF: one blank page. The stub's every document. */
const BLANK_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

/** The records whose answer a test can lose: the record is made, and the call fails. */
export type StubBooksCreate = "recordPayment" | "recordRefund" | "upsertCustomer" | "createInvoice" | "createItem";

/** The calls a test can make fail, or have refused, once. */
export type StubBooksStep =
  StubBooksCreate | "updateCustomer" | "crmContactOf" | "eraseCustomer" | "findInvoice" | "items" | "updateItem";

/** The stub, and what was written to it, for tests to read. */
export interface StubBooks extends BooksProvider {
  readonly made: {
    readonly payments: NewBooksPayment[];
    readonly applied: { paymentId: string; invoiceId: string; amount: number }[];
    readonly refunds: (NewBooksRefund & { paymentId: string })[];
    /** The invoices marked sent, in the order they were. */
    readonly issued: string[];
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

/** The items Books holds before a test adds any. */
interface StubBooksWorld {
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
export function createStubBooks(world: StubBooksWorld = {}): StubBooks {
  const made = {
    payments: [] as NewBooksPayment[],
    applied: [] as { paymentId: string; invoiceId: string; amount: number }[],
    refunds: [] as (NewBooksRefund & { paymentId: string })[],
    issued: [] as string[],
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
type CustomerCalls = "upsertCustomer" | "updateCustomer" | "crmContactOf" | "eraseCustomer";
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
    invoice: (id) => {
      const raised = invoicesById.get(id);
      if (raised !== undefined) return Promise.resolve({ ...raised, status: issuedOrDraft(id) });
      if (!id.startsWith("stub-")) return Promise.resolve(null);
      const number = `INV-${id.slice(5).padStart(6, "0")}`;
      const status = issuedOrDraft(id);
      return Promise.resolve({ id, number, date: "2026-09-22", total: 0, balance: 0, status, reference: null });
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
      const raised = {
        id,
        number,
        date: invoice.date,
        total,
        balance: total,
        status: "draft",
        reference: invoice.reference,
      };
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
    // Books' CRM integration has made a Contact of every customer.
    async crmContactOf(customerId) {
      await controls.check("crmContactOf");
      return `stub-crm-contact-${customerId}`;
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
      held.push({ id, name: item.name, rate: item.rate, active: true, sac: item.sac });
      return controls.answer("createItem", id, id);
    },
    async updateItem(itemId, item) {
      await controls.check("updateItem");
      made.itemUpdates.push({ itemId, ...item });
      const index = held.findIndex((each) => each.id === itemId);
      const current = held[index];
      if (current !== undefined)
        held[index] = { ...current, name: item.name, rate: item.rate, sac: item.sac ?? current.sac };
    },
  };
  return stub;
}
