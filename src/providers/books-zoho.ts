// Zoho Books' API behind BooksProvider (src/providers/books.ts). Amounts are rupees here and paise everywhere else,
// and every path also takes ?organization_id=.
//
//   GET    /books/v3/invoices/{id}                   { invoice }; with &accept=pdf, the PDF
//   POST   /books/v3/invoices/{id}/status/sent       marks a draft sent
//   PUT    /books/v3/invoices/{id}                   a draft's lines, all sent back, the visit's with its discount
//   GET    /books/v3/invoices&reference_number=      an exact search: { invoices }
//   POST   /books/v3/invoices                        201 { invoice }
//   POST   /books/v3/invoices/{id}/credits           a payment applied to an invoice
//   GET    /books/v3/customerpayments&customer_id=&reference_number=      { customerpayments }
//   POST   /books/v3/customerpayments                { payment }; GET .../{id} with &accept=pdf, the receipt
//   GET    /books/v3/customerpayments/{id}/refunds   { payment_refunds }; POST records one
//   PUT    /books/v3/contacts                        keyed by X-Unique-Identifier-Key/-Value and X-Upsert:
//                                                    201 added or 200 saved, { contact }
//   PUT    /books/v3/contacts/{id}                   the contact persons sent replace those held
//   DELETE /books/v3/contacts/{id}                   400 code 3000 while a document or payment names it
//   POST   /books/v3/contacts/{id}/inactive
//   GET    /books/v3/items&page=&per_page=           { items, page_context: { has_more_page } }
//   POST   /books/v3/items                           201 { item }; PUT .../{id} writes over one
//
// Books refuses gst_treatment, place_of_contact and place_of_supply while GST is off in the org (400 code 8,
// "Invalid Element"), so they are sent only with a state code.
//
// Read from Books' documentation and not yet tried on the org: writing a discount onto a draft (docs/open-points.md,
// item 181). scripts/zoho-contract-probe.ts tries every read on the org.

import { z } from "zod";
import type { ZohoBooksSettings } from "../config/settings.ts";
import type {
  BooksErasure,
  BooksInvoice,
  BooksItem,
  BooksItemDetails,
  BooksProvider,
  NewBooksCustomer,
  NewBooksInvoice,
} from "./books.ts";
import {
  answerOf,
  createZohoRequester,
  readAnswer,
  ZohoError,
  type ZohoRequest,
  type ZohoRequesterDependencies,
  type ZohoWrite,
} from "./zoho-http.ts";

/** How many items a page of Books' list holds, and the most pages one read of the list takes. */
const BOOKS_ITEMS_A_PAGE = 200;
export const BOOKS_ITEM_PAGES = 5;

/** The customer field that holds our person ID. Books keeps its values unique. */
const PERSON_ID_FIELD = "cf_mm_person_id";
/** Books' code for a customer it will not delete because a document or payment names it. */
const CUSTOMER_IN_USE = "3000";
const ERASED_NAME = "Erased client";

export function createZohoBooks(settings: ZohoBooksSettings, deps: ZohoRequesterDependencies): BooksProvider {
  const books = booksApi(createZohoRequester("books", settings, deps), settings.orgId);
  return {
    ...documentCalls(books),
    ...paymentCalls(books),
    ...customerCalls(books),
    ...invoiceCalls(books),
    ...itemCalls(books),
  };
}

interface BooksApi {
  readonly request: ZohoRequest;
  /** "organization_id=…", which every path takes. */
  readonly org: string;
  /** A path in the org: `at("/contacts", "&page=2")`. */
  readonly at: (path: string, query?: string) => string;
  /** One call, and the part of its answer at `under`, read by `schema`; a misfit names the step. */
  readonly read: <T extends z.ZodType>(
    step: string,
    path: string,
    schema: T,
    under: readonly PropertyKey[],
    write?: ZohoWrite,
  ) => Promise<z.infer<T>>;
}

function booksApi(request: ZohoRequest, orgId: string): BooksApi {
  const org = `organization_id=${encodeURIComponent(orgId)}`;
  return {
    request,
    org,
    at: (path, query = "") => `/books/v3${path}?${org}${query}`,
    async read(step, path, schema, under, write) {
      const response = await request(step, path, write);
      return readAnswer(await answerOf(step, response), schema, under);
    },
  };
}

/** Paise as Books takes an amount: rupees. */
const rupees = (amountInPaise: number) => amountInPaise / 100;
/** Rupees as Books gives an amount: paise. */
const paise = (amountInRupees: number) => Math.round(amountInRupees * 100);

// ---------------------------------------------------------------------------
// Invoices, their documents, and payments
// ---------------------------------------------------------------------------

const Invoice = z.object({
  invoice_id: z.string(),
  invoice_number: z.string(),
  date: z.string(),
  total: z.number(),
  balance: z.number().optional(),
  status: z.string(),
  reference_number: z.string().nullish(),
});

/** The payments a search found. Books may match a reference loosely, so each is compared again here. */
const PaymentsFound = z.object({
  customerpayments: z.array(z.object({ payment_id: z.string(), reference_number: z.string().nullish() })).default([]),
});
const RefundsFound = z.object({
  payment_refunds: z
    .array(z.object({ payment_refund_id: z.string(), reference_number: z.string().nullish() }))
    .default([]),
});

/** An invoice as Books gives it, its amounts in paise. */
const booksInvoiceOf = (invoice: z.infer<typeof Invoice>): BooksInvoice => ({
  id: invoice.invoice_id,
  number: invoice.invoice_number,
  date: invoice.date,
  total: paise(invoice.total),
  balance: paise(invoice.balance ?? invoice.total),
  status: invoice.status,
  reference: filledOrNull(invoice.reference_number),
});

/** A text field as Books gives it: empty, null or left out when there is nothing in it, which is null here. */
function filledOrNull(text: string | null | undefined): string | null {
  if (text === undefined || text === null || text.trim() === "") return null;
  return text;
}

/** Books answers 404 for a record it does not have; that is "unavailable", not a failure. */
async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ZohoError && error.status === 404) return null;
    throw error;
  }
}

type Documents = Pick<BooksProvider, "invoice" | "issueInvoice" | "invoicePdf">;

function documentCalls({ request, org, read }: BooksApi): Documents {
  const path = (id: string, extra = "") => `/books/v3/invoices/${encodeURIComponent(id)}?${org}${extra}`;

  return {
    invoice: (id) => orNull(async () => booksInvoiceOf(await read("invoice", path(id), Invoice, ["invoice"]))),

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
  };
}

type Payments = Pick<
  BooksProvider,
  "findPayment" | "recordPayment" | "receiptPdf" | "applyToInvoice" | "findRefund" | "recordRefund"
>;

function paymentCalls({ request, org, read }: BooksApi): Payments {
  const payments = (id?: string, tail = "") =>
    `/books/v3/customerpayments${id === undefined ? "" : `/${encodeURIComponent(id)}`}${tail}?${org}`;

  return {
    async findPayment(customerId, reference) {
      const query = `&customer_id=${encodeURIComponent(customerId)}&reference_number=${encodeURIComponent(reference)}`;
      const found = (await read("find_payment", `${payments()}${query}`, PaymentsFound, [])).customerpayments;
      return found.find((each) => each.reference_number === reference)?.payment_id ?? null;
    },

    recordPayment: (payment) =>
      read("record_payment", payments(), z.string(), ["payment", "payment_id"], {
        method: "POST",
        body: {
          customer_id: payment.customerId,
          payment_mode: "Razorpay",
          amount: rupees(payment.amount),
          date: payment.date,
          reference_number: payment.reference,
          description: payment.description,
        },
      }),

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
      const found = (await read("find_refund", payments(paymentId, "/refunds"), RefundsFound, [])).payment_refunds;
      return found.find((each) => each.reference_number === reference)?.payment_refund_id ?? null;
    },

    recordRefund: (paymentId, refund) =>
      read("record_refund", payments(paymentId, "/refunds"), z.string(), ["payment_refund", "payment_refund_id"], {
        method: "POST",
        body: {
          date: refund.date,
          refund_mode: "Razorpay",
          amount: rupees(refund.amount),
          from_account_id: refund.fromAccountId,
          reference_number: refund.reference,
          description: refund.description,
        },
      }),
  };
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

/** The customer as Books takes it. Its one contact person carries the number and e-mail, and replaces any held. */
function customerBody(customer: NewBooksCustomer) {
  const [firstName = "", ...rest] = customer.name.trim().split(/\s+/);
  const person = {
    first_name: firstName,
    last_name: rest.join(" "),
    mobile: customer.mobile,
    ...(customer.email === null ? {} : { email: customer.email }),
    is_primary_contact: true,
  };
  return {
    contact_name: customer.name,
    contact_type: "customer",
    customer_sub_type: "individual",
    ...(customer.stateCode === null ? {} : { gst_treatment: "consumer", place_of_contact: customer.stateCode }),
    ...(customer.address === null ? {} : { billing_address: billingAddress(customer.address) }),
    contact_persons: [person],
    custom_fields: [{ api_name: PERSON_ID_FIELD, value: customer.personId }],
  };
}

function billingAddress(address: NonNullable<NewBooksCustomer["address"]>) {
  return {
    address: address.street1,
    street2: address.street2 ?? "",
    city: address.city,
    state: address.state ?? "",
    zip: address.pincode,
    country: "India",
  };
}

const BLANK_ADDRESS = { address: "", street2: "", city: "", state: "", zip: "", country: "" };

/** An erased customer: renamed, with no contact person, and so no number or e-mail, and no address. */
const ERASED_CUSTOMER = {
  contact_name: ERASED_NAME,
  contact_persons: [],
  billing_address: BLANK_ADDRESS,
  shipping_address: BLANK_ADDRESS,
};

type Customers = Pick<BooksProvider, "upsertCustomer" | "updateCustomer" | "eraseCustomer">;

function customerCalls({ request, at, read }: BooksApi): Customers {
  const contact = (id: string, tail = "") => at(`/contacts/${encodeURIComponent(id)}${tail}`);

  /** Deletes the customer, or says Books keeps it because a document or payment names it. */
  async function deleteCustomer(customerId: string): Promise<"deleted" | "in_use"> {
    try {
      await orNull(() => request("delete_customer", contact(customerId), { method: "DELETE" }));
      return "deleted";
    } catch (error) {
      if (error instanceof ZohoError && error.code === CUSTOMER_IN_USE) return "in_use";
      throw error;
    }
  }

  return {
    upsertCustomer: (customer) =>
      read("upsert_customer", at("/contacts"), z.string(), ["contact", "contact_id"], {
        method: "PUT",
        body: customerBody(customer),
        headers: {
          "X-Unique-Identifier-Key": PERSON_ID_FIELD,
          "X-Unique-Identifier-Value": customer.personId,
          "X-Upsert": "true",
        },
      }),

    async updateCustomer(customerId, customer) {
      await request("update_customer", contact(customerId), { method: "PUT", body: customerBody(customer) });
    },

    async eraseCustomer(customerId): Promise<BooksErasure> {
      if ((await deleteCustomer(customerId)) === "deleted") return "deleted";
      await request("erase_customer", contact(customerId), { method: "PUT", body: ERASED_CUSTOMER });
      await request("deactivate_customer", contact(customerId, "/inactive"), { method: "POST", body: {} });
      return "blanked";
    },
  };
}

// ---------------------------------------------------------------------------
// The invoices we raise
// ---------------------------------------------------------------------------

const InvoicesFound = z.object({ invoices: z.array(Invoice.extend({ reference_number: z.string() })) });

/** One line on the visit's item, its rate GST-inclusive and its discount taken before tax. */
function invoiceBody(invoice: NewBooksInvoice) {
  const { line } = invoice;
  const place = invoice.placeOfSupply;
  return {
    customer_id: invoice.customerId,
    reference_number: invoice.reference,
    date: invoice.date,
    ...(place === null ? {} : { gst_treatment: "consumer", place_of_supply: place }),
    is_inclusive_tax: true,
    is_discount_before_tax: true,
    discount_type: "item_level",
    line_items: [
      {
        item_id: line.itemId,
        name: line.name,
        description: line.description,
        rate: rupees(line.rate),
        quantity: 1,
        discount: rupees(line.discount),
      },
    ],
  };
}

type InvoicesWeRaise = Pick<BooksProvider, "findInvoice" | "createInvoice">;

function invoiceCalls({ at, read }: BooksApi): InvoicesWeRaise {
  return {
    async findInvoice(reference) {
      const query = `&reference_number=${encodeURIComponent(reference)}`;
      const found = await read("find_invoice", at("/invoices", query), InvoicesFound, []);
      const ours = found.invoices.find((invoice) => invoice.reference_number === reference);
      return ours === undefined ? null : booksInvoiceOf(ours);
    },

    async createInvoice(invoice) {
      const made = await read("create_invoice", at("/invoices"), Invoice, ["invoice"], {
        method: "POST",
        body: invoiceBody(invoice),
      });
      return booksInvoiceOf(made);
    },
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const ItemsPage = z.object({
  items: z.array(
    z.object({
      item_id: z.string(),
      name: z.string(),
      rate: z.number(),
      status: z.string(),
      hsn_or_sac: z.string().nullish(),
    }),
  ),
  page_context: z.object({ has_more_page: z.boolean() }),
});

const booksItemOf = (item: z.infer<typeof ItemsPage>["items"][number]): BooksItem => ({
  id: item.item_id,
  name: item.name,
  rate: paise(item.rate),
  active: item.status === "active",
  sac: filledOrNull(item.hsn_or_sac),
});

/** A service item as Books takes it; the SAC code only once there is one, as it is only once GST is on. */
function itemBody(item: BooksItemDetails) {
  return {
    name: item.name,
    rate: rupees(item.rate),
    ...(item.sac === null ? {} : { hsn_or_sac: item.sac }),
  };
}

type Items = Pick<BooksProvider, "items" | "createItem" | "updateItem">;

function itemCalls({ request, at, read }: BooksApi): Items {
  return {
    async items() {
      const found: BooksItem[] = [];
      for (let page = 1; page <= BOOKS_ITEM_PAGES; page += 1) {
        const query = `&page=${String(page)}&per_page=${String(BOOKS_ITEMS_A_PAGE)}`;
        const answer = await read("items", at("/items", query), ItemsPage, []);
        found.push(...answer.items.map(booksItemOf));
        if (!answer.page_context.has_more_page) return found;
      }
      const most = String(BOOKS_ITEM_PAGES * BOOKS_ITEMS_A_PAGE);
      throw new ZohoError(0, "TOO_MANY_ITEMS", `Books holds more than ${most} items, more than one read takes`, false);
    },

    createItem: (item) =>
      read("create_item", at("/items"), z.string(), ["item", "item_id"], {
        method: "POST",
        body: { ...itemBody(item), product_type: "service" },
      }),

    async updateItem(itemId, item) {
      await request("update_item", at(`/items/${encodeURIComponent(itemId)}`), {
        method: "PUT",
        body: itemBody(item),
      });
    },
  };
}
