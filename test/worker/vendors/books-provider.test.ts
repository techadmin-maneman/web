// Zoho Books' adapter (src/providers/books/zoho.ts) on a Zoho client of its own. Customers, invoices, items and the
// searches for a payment or a refund are read from answers the org gave (test/fixtures/vendors/books, recorded by
// scripts/staging/books-proof.ts and scripts/release/zoho-contract-probe.ts, with no one's details in them); the rest from Books'
// documentation.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { NO_GST } from "../../../src/config/gst.ts";
import type { ZohoBooksSettings } from "../../../src/config/settings.ts";
import { createLogger } from "../../../src/log.ts";
import {
  BOOKS_ITEM_PAGES,
  createBooksProvider,
  type NewBooksCustomer,
  type NewBooksInvoice,
} from "../../../src/providers/books/index.ts";
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import { NOW, captureLogs, fakeFetch, json, type RecordedCall } from "../helpers.ts";
import contactAdded from "../../fixtures/vendors/books/contact-added.json";
import contactDeleted from "../../fixtures/vendors/books/contact-deleted.json";
import contactErased from "../../fixtures/vendors/books/contact-erased.json";
import contactGone from "../../fixtures/vendors/books/contact-gone.json";
import contactInUse from "../../fixtures/vendors/books/contact-in-use.json";
import contactInactive from "../../fixtures/vendors/books/contact-inactive.json";
import contactSaved from "../../fixtures/vendors/books/contact-saved.json";
import gstOff from "../../fixtures/vendors/books/gst-off.json";
import invoiceCreated from "../../fixtures/vendors/books/invoice-created.json";
import invoicesByReference from "../../fixtures/vendors/books/invoices-by-reference.json";
import itemAdded from "../../fixtures/vendors/books/item-added.json";
import itemSaved from "../../fixtures/vendors/books/item-saved.json";
import itemsPage from "../../fixtures/vendors/books/items-page.json";
import paymentsByReference from "../../fixtures/vendors/books/payments-by-reference.json";
import refundsOfPayment from "../../fixtures/vendors/books/refunds-of-payment.json";

const SETTINGS: ZohoBooksSettings = {
  clientId: "1000.BOOKSCLIENT",
  clientSecret: "books-client-secret",
  refreshToken: "1000.books-refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  orgId: "60088931635",
  refundAccountId: null,
  gst: NO_GST,
};

const ZOHO_TOKEN_URL = "https://accounts.zoho.in/oauth/v2/token";
const BOOKS_API = "https://www.zohoapis.in/books/v3";
const tokenIssued = () => json({ access_token: "books-access-1", expires_in: 3600, token_type: "Bearer" });

function zohoBooks(routes: Parameters<typeof fakeFetch>[0]) {
  const http = fakeFetch(routes);
  const deps = { db: env.DB, fetch: http.fetch, now: () => NOW, log: createLogger() };
  return { books: createBooksProvider("zoho", SETTINGS, deps), calls: http.calls };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
});

/** What a call sent, as JSON; null for a call that sent nothing. */
const sent = (call: RecordedCall | undefined): unknown => (call?.body ? JSON.parse(call.body) : null);
const pathOf = (call: RecordedCall | undefined) => new URL(call?.url ?? "").pathname;
/** The calls after the first, which mints the access token. */
const booksCalls = (calls: readonly RecordedCall[]) => calls.slice(1);

const PERSON_ID = contactAdded.contact.custom_fields[0]?.value ?? "";
const CUSTOMER_ID = contactAdded.contact.contact_id;

const ADDRESS = {
  street1: "Flat 1, Staging test",
  street2: "Near the park",
  city: "Gurgaon",
  state: "Haryana",
  pincode: "122002",
};

const CUSTOMER: NewBooksCustomer = {
  personId: PERSON_ID,
  name: "Staging test",
  mobile: "+919000000001",
  email: null,
  stateCode: null,
  address: ADDRESS,
};

/** The customer as Books is sent it, with no GST fields: Books refuses them while GST is off (gst-off.json). */
const CUSTOMER_SENT = {
  contact_name: "Staging test",
  contact_type: "customer",
  customer_sub_type: "individual",
  billing_address: {
    address: "Flat 1, Staging test",
    street2: "Near the park",
    city: "Gurgaon",
    state: "Haryana",
    zip: "122002",
    country: "India",
  },
  contact_persons: [{ first_name: "Staging", last_name: "test", mobile: "+919000000001", is_primary_contact: true }],
  custom_fields: [{ api_name: "cf_mm_person_id", value: PERSON_ID }],
};

describe("Books: customers", () => {
  it("adds a customer keyed by our person ID, and answers Books' ID for it", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json(contactAdded, 201),
    });
    expect(await books.upsertCustomer(CUSTOMER)).toBe(CUSTOMER_ID);
    const [written] = booksCalls(calls);
    expect(written?.method).toBe("PUT");
    expect(pathOf(written)).toBe("/books/v3/contacts");
    expect(new URL(written?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
    expect(written?.headers.get("X-Unique-Identifier-Key")).toBe("cf_mm_person_id");
    expect(written?.headers.get("X-Unique-Identifier-Value")).toBe(PERSON_ID);
    expect(written?.headers.get("X-Upsert")).toBe("true");
    expect(sent(written)).toEqual(CUSTOMER_SENT);
  });

  it("finds the customer it made before by our person ID, so a retry whose answer was lost makes no second", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json(contactSaved, 200),
    });
    const moved = { ...CUSTOMER, address: { ...ADDRESS, street1: "Flat 2, Staging test" } };
    expect(await books.upsertCustomer(moved)).toBe(CUSTOMER_ID);
  });

  it("sends the GST treatment and place of contact only with a state code", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json(gstOff, 400),
    });
    await expect(books.upsertCustomer({ ...CUSTOMER, stateCode: "HR" })).rejects.toThrow(
      "Zoho 400 8: Invalid Element gst_treatment",
    );
    expect(sent(booksCalls(calls)[0])).toEqual({ ...CUSTOMER_SENT, gst_treatment: "consumer", place_of_contact: "HR" });
  });

  it("names an e-mail it has, and leaves out an address it does not", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json(contactAdded, 201),
    });
    await books.upsertCustomer({ ...CUSTOMER, name: "Asha", email: "asha@example.com", address: null });
    const { billing_address: _, ...withoutAddress } = CUSTOMER_SENT;
    expect(sent(booksCalls(calls)[0])).toEqual({
      ...withoutAddress,
      contact_name: "Asha",
      contact_persons: [
        {
          first_name: "Asha",
          last_name: "",
          mobile: "+919000000001",
          email: "asha@example.com",
          is_primary_contact: true,
        },
      ],
    });
  });

  it("sends a blank second line and state for an address that has neither", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json(contactAdded, 201),
    });
    await books.upsertCustomer({ ...CUSTOMER, address: { ...ADDRESS, street2: null, state: null } });
    expect(sent(booksCalls(calls)[0])).toMatchObject({
      billing_address: { address: "Flat 1, Staging test", street2: "", city: "Gurgaon", state: "", zip: "122002" },
    });
  });

  it("fails naming the step when Books' answer has no customer ID", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => json({ code: 0, message: "The contact has been added.", contact: {} }, 201),
    });
    await expect(books.upsertCustomer(CUSTOMER)).rejects.toThrow(
      /upsert_customer: contact\.contact_id: .*expected string/,
    );
  });

  it("writes a client's new number and address over their customer", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: () => json(contactSaved),
    });
    await books.updateCustomer(CUSTOMER_ID, CUSTOMER);
    const [written] = booksCalls(calls);
    expect(written?.method).toBe("PUT");
    expect(written?.headers.get("X-Upsert")).toBeNull();
    expect(sent(written)).toEqual(CUSTOMER_SENT);
  });
});

describe("Books: erasing a customer", () => {
  const ERASED_ADDRESS = { address: "", street2: "", city: "", state: "", zip: "", country: "" };

  it("deletes a customer no invoice or payment names", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: () => json(contactDeleted),
    });
    expect(await books.eraseCustomer(CUSTOMER_ID)).toBe("deleted");
    const [deleted, ...rest] = booksCalls(calls);
    expect(deleted?.method).toBe("DELETE");
    expect(deleted?.body).toBe("");
    expect(deleted?.headers.get("Content-Type")).toBeNull();
    expect(rest).toEqual([]);
  });

  it("renames, blanks and switches off a customer that Books keeps because a document names it", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}/inactive`]: () => json(contactInactive),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: (call) =>
        call.method === "DELETE" ? json(contactInUse, 400) : json(contactErased),
    });
    expect(await books.eraseCustomer(CUSTOMER_ID)).toBe("blanked");
    const steps = booksCalls(calls).map((call) => `${call.method} ${pathOf(call)}`);
    expect(steps).toEqual([
      `DELETE /books/v3/contacts/${CUSTOMER_ID}`,
      `PUT /books/v3/contacts/${CUSTOMER_ID}`,
      `POST /books/v3/contacts/${CUSTOMER_ID}/inactive`,
    ]);
    expect(sent(booksCalls(calls)[1])).toEqual({
      contact_name: "Erased client",
      contact_persons: [],
      billing_address: ERASED_ADDRESS,
      shipping_address: ERASED_ADDRESS,
    });
  });

  it("takes a customer Books no longer has as erased already", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: () => json(contactGone, 404),
    });
    expect(await books.eraseCustomer(CUSTOMER_ID)).toBe("deleted");
  });

  it("fails on any other answer, so the erasure is tried again", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: () => json({ code: 9, message: "Internal error" }, 500),
    });
    await expect(books.eraseCustomer(CUSTOMER_ID)).rejects.toThrow("Zoho 500 9: Internal error");
  });
});

describe("Books: the invoices we raise", () => {
  const REFERENCE = invoiceCreated.invoice.reference_number;
  const INVOICE: NewBooksInvoice = {
    customerId: CUSTOMER_ID,
    reference: REFERENCE,
    date: "2026-10-02",
    placeOfSupply: null,
    line: {
      itemId: "4242595000000245041",
      name: "Staging test: first fit",
      description: "Staging test visit",
      rate: 200_000,
      discount: 15_000,
    },
  };
  const INVOICE_SENT = {
    customer_id: CUSTOMER_ID,
    reference_number: REFERENCE,
    date: "2026-10-02",
    is_inclusive_tax: true,
    is_discount_before_tax: true,
    discount_type: "item_level",
    line_items: [
      {
        item_id: "4242595000000245041",
        name: "Staging test: first fit",
        description: "Staging test visit",
        rate: 2000,
        quantity: 1,
        discount: 150,
      },
    ],
  };

  it("raises a draft on the visit's item, the price GST-inclusive and the discount before tax, under our reference", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices`]: () => json(invoiceCreated, 201),
    });
    expect(await books.createInvoice(INVOICE)).toEqual({
      id: "4242595000000257006",
      number: "INV-000004",
      date: "2026-10-02",
      total: 185_000,
      balance: 185_000,
      status: "draft",
      reference: REFERENCE,
    });
    const [written] = booksCalls(calls);
    expect(written?.method).toBe("POST");
    expect(sent(written)).toEqual(INVOICE_SENT);
  });

  it("names the GST treatment and place of supply only when given one", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices`]: () => json(gstOff, 400),
    });
    await expect(books.createInvoice({ ...INVOICE, placeOfSupply: "HR" })).rejects.toThrow(/Invalid Element/);
    expect(sent(booksCalls(calls)[0])).toEqual({ ...INVOICE_SENT, gst_treatment: "consumer", place_of_supply: "HR" });
  });

  it("finds an invoice by our reference, matching it exactly", async () => {
    const [found] = invoicesByReference.invoices;
    const nearMiss = { ...found, invoice_id: "near-miss", reference_number: `${REFERENCE}-2` };
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices`]: () => json({ ...invoicesByReference, invoices: [nearMiss, found] }),
    });
    expect(await books.findInvoice(REFERENCE)).toMatchObject({
      id: "4242595000000257006",
      total: 185_000,
      reference: REFERENCE,
    });
    expect(new URL(booksCalls(calls)[0]?.url ?? "").searchParams.get("reference_number")).toBe(REFERENCE);
    expect(await books.findInvoice("staging-proof-none")).toBeNull();
  });
});

describe("Books: items", () => {
  const morePages = { ...itemsPage, page_context: { ...itemsPage.page_context, has_more_page: true } };
  const lastPage = {
    ...itemsPage,
    items: [itemSaved.item],
    page_context: { page: 2, per_page: 200, has_more_page: false },
  };

  it("reads every item a page at a time, its rate in paise", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/items`]: (call) =>
        new URL(call.url).searchParams.get("page") === "1" ? json(morePages) : json(lastPage),
    });
    const items = await books.items();
    expect(items).toHaveLength(6);
    expect(items[1]).toEqual({
      id: "4242595000000034206",
      name: "First fit",
      rate: 3_000_000,
      active: true,
      sac: null,
    });
    expect(items[5]).toEqual({
      id: "4242595000000245041",
      name: "Staging test: proof item 82af00 b",
      rate: 200_000,
      active: true,
      sac: null,
    });
    expect(booksCalls(calls).map((call) => new URL(call.url).searchParams.get("per_page"))).toEqual(["200", "200"]);
  });

  it("refuses a list longer than it reads, rather than answer part of it", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/items`]: () => json(morePages),
    });
    await expect(books.items()).rejects.toThrow(/TOO_MANY_ITEMS/);
    expect(booksCalls(calls)).toHaveLength(BOOKS_ITEM_PAGES);
  });

  it("adds a service item, its rate in rupees, and answers its ID", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/items`]: () => json(itemAdded, 201),
    });
    expect(await books.createItem({ name: "Staging test: proof item 82af00", rate: 123_450, sac: null })).toBe(
      "4242595000000245041",
    );
    expect(sent(booksCalls(calls)[0])).toEqual({
      name: "Staging test: proof item 82af00",
      rate: 1234.5,
      product_type: "service",
    });
  });

  it("writes a new name and rate over an item", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/items/4242595000000245041`]: () => json(itemSaved),
    });
    await books.updateItem("4242595000000245041", {
      name: "Staging test: proof item 82af00 b",
      rate: 200_000,
      sac: null,
    });
    const [written] = booksCalls(calls);
    expect(written?.method).toBe("PUT");
    expect(sent(written)).toEqual({ name: "Staging test: proof item 82af00 b", rate: 2000 });
  });

  it("writes the SAC code once there is one, and reads it back", async () => {
    const withSac = { ...lastPage, items: [{ ...itemSaved.item, hsn_or_sac: "999721" }] };
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/items/4242595000000245041`]: () => json(itemSaved),
      [`${BOOKS_API}/items`]: (call) => (call.method === "POST" ? json(itemAdded, 201) : json(withSac)),
    });
    await books.createItem({ name: "Service visit", rate: 200_000, sac: "999721" });
    await books.updateItem("4242595000000245041", { name: "Service visit", rate: 200_000, sac: "999721" });
    const [made, written] = booksCalls(calls);
    expect(sent(made)).toEqual({ name: "Service visit", rate: 2000, hsn_or_sac: "999721", product_type: "service" });
    expect(sent(written)).toEqual({ name: "Service visit", rate: 2000, hsn_or_sac: "999721" });
    expect((await books.items())[0]?.sac).toBe("999721");
  });
});

describe("Books: invoices", () => {
  it("reads an invoice's number, date, total in paise, status and reference, from the configured organisation", async () => {
    const { invoice } = invoiceCreated;
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/${invoice.invoice_id}`]: () => json({ code: 0, message: "success", invoice }),
    });
    expect(await books.invoice(invoice.invoice_id)).toEqual({
      id: "4242595000000257006",
      number: "INV-000004",
      date: "2026-10-02",
      total: 185_000,
      balance: 185_000,
      status: "draft",
      reference: invoice.reference_number,
    });
    expect(new URL(calls[1]?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
  });

  it("reads an invoice Books gives no reference or balance as having none, and owing its total", async () => {
    const { reference_number: _, balance: __, ...plain } = invoiceCreated.invoice;
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/${plain.invoice_id}`]: () => json({ ...invoiceCreated, invoice: plain }),
    });
    expect(await books.invoice(plain.invoice_id)).toMatchObject({ total: 185_000, balance: 185_000, reference: null });
  });

  it("streams an invoice's PDF, and answers null for one Books does not have", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1`]: () =>
        new Response("%PDF-1.4", { headers: { "Content-Type": "application/pdf" } }),
      [`${BOOKS_API}/invoices/missing`]: () => json({ code: 1002, message: "Invoice does not exist." }, 404),
    });
    const pdf = await books.invoicePdf("inv-1");
    expect(await new Response(pdf?.body).text()).toBe("%PDF-1.4");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("accept")).toBe("pdf");
    expect(await books.invoicePdf("missing")).toBeNull();
  });
});

describe("Books: payments, receipts and refunds", () => {
  const body = (call: { body: string } | undefined) => JSON.parse(call?.body ?? "null") as unknown;

  it("records a payment in rupees, against the client's customer, with what it was for, and returns its ID", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ code: 0, payment: { payment_id: "bp-1" } }, 201),
    });
    const id = await books.recordPayment({
      customerId: "books-customer-9",
      amount: 3000050,
      date: "2026-09-21",
      reference: "MM-2026-0841",
      description: "Staging test: Razorpay payment pay_test41",
      supply: "Staging test: Advance for First fit, Mon 21 Sep",
    });
    expect(id).toBe("bp-1");
    expect(calls[1]?.method).toBe("POST");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
    expect(body(calls[1])).toEqual({
      customer_id: "books-customer-9",
      payment_mode: "Razorpay",
      amount: 30000.5,
      date: "2026-09-21",
      reference_number: "MM-2026-0841",
      description: "Staging test: Razorpay payment pay_test41",
      product_description: "Staging test: Advance for First fit, Mon 21 Sep",
    });
  });

  it("streams a payment's receipt, and answers null for one Books does not have", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/bp-1`]: () =>
        new Response("%PDF-1.4", { headers: { "Content-Type": "application/pdf" } }),
      [`${BOOKS_API}/customerpayments/missing`]: () => json({ code: 1002, message: "Payment does not exist." }, 404),
    });
    expect(await new Response((await books.receiptPdf("bp-1"))?.body).text()).toBe("%PDF-1.4");
    expect(new URL(calls[1]?.url ?? "").searchParams.get("accept")).toBe("pdf");
    expect(await books.receiptPdf("missing")).toBeNull();
  });

  it("applies a payment to an invoice, in rupees", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1/credits`]: () => json({ code: 0, message: "Payment applied." }),
    });
    await books.applyToInvoice("bp-1", "inv-1", 3000000);
    expect(calls[1]?.method).toBe("POST");
    expect(body(calls[1])).toEqual({ invoice_payments: [{ payment_id: "bp-1", amount_applied: 30000 }] });
  });

  it("records a refund from the given account, and returns its ID", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/bp-1/refunds`]: () =>
        json({ code: 0, payment_refund: { payment_refund_id: "br-1" } }, 201),
    });
    const id = await books.recordRefund("bp-1", {
      amount: 100000,
      date: "2026-09-22",
      reference: "rfnd_test7",
      description: "Staging test: Razorpay refund rfnd_test7",
      fromAccountId: "bank-7",
    });
    expect(id).toBe("br-1");
    expect(body(calls[1])).toEqual({
      date: "2026-09-22",
      refund_mode: "Razorpay",
      amount: 1000,
      from_account_id: "bank-7",
      reference_number: "rfnd_test7",
      description: "Staging test: Razorpay refund rfnd_test7",
    });
  });

  it("finds a payment by our reference for the customer, matching the reference exactly", async () => {
    const [found] = paymentsByReference.customerpayments;
    const customerId = found?.customer_id ?? "";
    const reference = found?.reference_number ?? "";
    const nearMiss = { ...found, payment_id: "near-miss", reference_number: `${reference}0` };
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ ...paymentsByReference, customerpayments: [nearMiss, found] }),
    });
    expect(await books.findPayment(customerId, reference)).toBe("4242595000000250002");
    const searched = new URL(calls[1]?.url ?? "");
    expect(calls[1]?.method).toBe("GET");
    expect(searched.searchParams.get("customer_id")).toBe(customerId);
    expect(searched.searchParams.get("reference_number")).toBe(reference);
    expect(await books.findPayment(customerId, "MM-2026-0999")).toBeNull();
  });

  it("finds a refund of a payment by Razorpay's refund ID, and answers null when there is none", async () => {
    const [refund] = refundsOfPayment.payment_refunds;
    const paymentId = refund?.payment_id ?? "";
    const reference = refund?.reference_number ?? "";
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/${paymentId}/refunds`]: () => json(refundsOfPayment),
      [`${BOOKS_API}/customerpayments/bp-2/refunds`]: () => json({ ...refundsOfPayment, payment_refunds: [] }),
    });
    expect(await books.findRefund(paymentId, reference)).toBe("4242595000000247023");
    expect(await books.findRefund(paymentId, "rfnd_other")).toBeNull();
    expect(await books.findRefund("bp-2", reference)).toBeNull();
  });

  it("fails loudly when Books refuses a payment", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ code: 1002, message: "Customer does not exist." }, 400),
    });
    const payment = { customerId: "x", amount: 100, date: "2026-09-21", reference: "r", description: "d", supply: "s" };
    await expect(books.recordPayment(payment)).rejects.toThrow(/400/);
  });
});

describe("Books: its client", () => {
  it("names no secret, token or URL in its logs when Books refuses a call", async () => {
    const logs = captureLogs();
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1/status/sent`]: () => json({ code: 1002, message: "Invoice does not exist." }, 400),
    });
    await expect(books.issueInvoice("inv-1")).rejects.toThrow("Zoho 400 1002: Invoice does not exist.");
    const lines = JSON.stringify(logs.lines());
    expect(lines).not.toMatch(/https:|books-client-secret|1000\.books-refresh|books-access-1/);
  });
});

describe("the stand-ins", () => {
  it("the stub Books has every stub- invoice as a blank PDF, and a receipt for every payment it records", async () => {
    const books = createStubBooks();
    expect((await books.invoice("stub-41"))?.number).toBe("INV-000041");
    expect(await new Response((await books.invoicePdf("stub-41"))?.body).text()).toMatch(/^%PDF-1\.4/);
    expect(await books.invoicePdf("real-1")).toBeNull();
    const payment = { customerId: "c", amount: 100, date: "2026-09-21", reference: "r", description: "d", supply: "s" };
    const recorded = await books.recordPayment(payment);
    expect(await new Response((await books.receiptPdf(recorded))?.body).text()).toMatch(/^%PDF-1\.4/);
    expect(await books.receiptPdf("real-1")).toBeNull();
    expect(books.made.payments).toEqual([payment]);
  });

  it("the stub Books keeps one customer per person, and a lost answer leaves the invoice to be found", async () => {
    const books = createStubBooks();
    const customerId = await books.upsertCustomer(CUSTOMER);
    expect(await books.upsertCustomer({ ...CUSTOMER, name: "Staging test again" })).toBe(customerId);
    expect(await books.upsertCustomer({ ...CUSTOMER, personId: "another" })).not.toBe(customerId);
    expect(books.made.customers.map((customer) => customer.name)).toEqual([
      "Staging test",
      "Staging test again",
      "Staging test",
    ]);

    const invoice: NewBooksInvoice = {
      customerId,
      reference: "appointment-1",
      date: "2026-10-02",
      placeOfSupply: null,
      line: { itemId: "stub-item-1", name: "First fit", description: "First fit", rate: 200_000, discount: 15_000 },
    };
    books.loseAnswer("createInvoice");
    await expect(books.createInvoice(invoice)).rejects.toThrow(/its answer never came/);
    const found = await books.findInvoice("appointment-1");
    expect(found).toMatchObject({ total: 185_000, balance: 185_000, status: "draft" });
    expect(books.made.invoices).toEqual([invoice]);
    await books.issueInvoice(found?.id ?? "");
    expect(await books.invoice(found?.id ?? "")).toMatchObject({ total: 185_000, status: "sent" });
    expect(await books.findInvoice("appointment-2")).toBeNull();
  });

  it("the stub Books deletes a customer nothing names, and blanks one a payment or invoice names", async () => {
    const books = createStubBooks();
    const unused = await books.upsertCustomer(CUSTOMER);
    const paid = await books.upsertCustomer({ ...CUSTOMER, personId: "paid" });
    const invoiced = await books.upsertCustomer({ ...CUSTOMER, personId: "invoiced" });
    await books.recordPayment({
      customerId: paid,
      amount: 100,
      date: "2026-10-02",
      reference: "r",
      description: "d",
      supply: "s",
    });
    const line = { itemId: "stub-item-1", name: "First fit", description: "First fit", rate: 100, discount: 0 };
    await books.createInvoice({
      customerId: invoiced,
      reference: "a-1",
      date: "2026-10-02",
      placeOfSupply: null,
      line,
    });
    expect(await books.eraseCustomer(unused)).toBe("deleted");
    expect(await books.eraseCustomer(paid)).toBe("blanked");
    expect(await books.eraseCustomer(invoiced)).toBe("blanked");
    expect(books.made.erased).toEqual([
      { customerId: unused, outcome: "deleted" },
      { customerId: paid, outcome: "blanked" },
      { customerId: invoiced, outcome: "blanked" },
    ]);
    expect(await books.upsertCustomer(CUSTOMER)).not.toBe(unused);
    await books.updateCustomer(paid, CUSTOMER);
    expect(books.made.customerUpdates).toEqual([{ customerId: paid, ...CUSTOMER }]);
  });

  it("the stub Books lists the items it was given and made, and fails or refuses a step once when asked", async () => {
    const given = { id: "stub-item-first-fit", name: "First fit", rate: 3_000_000, active: true, sac: null };
    const books = createStubBooks({ items: [given] });
    const made = await books.createItem({ name: "Service visit", rate: 200_000, sac: null });
    await books.updateItem(given.id, { name: "First fit", rate: 2_500_000, sac: "999721" });
    expect(await books.items()).toEqual([
      { ...given, rate: 2_500_000, sac: "999721" },
      { id: made, name: "Service visit", rate: 200_000, active: true, sac: null },
    ]);
    expect(books.made.itemsMade).toEqual([{ name: "Service visit", rate: 200_000, sac: null }]);
    expect(books.made.itemUpdates).toEqual([{ itemId: given.id, name: "First fit", rate: 2_500_000, sac: "999721" }]);

    books.failNext("items");
    await expect(books.items()).rejects.toThrow("the stub Books failed items");
    expect(await books.items()).toHaveLength(2);
    books.refuseNext("upsertCustomer", "120303");
    await expect(books.upsertCustomer(CUSTOMER)).rejects.toMatchObject({ status: 400, code: "120303", refusal: true });
    books.loseAnswer("createItem");
    await expect(books.createItem({ name: "Replacement", rate: 1, sac: null })).rejects.toThrow(
      /its answer never came/,
    );
    expect((await books.items()).map((item) => item.name)).toContain("Replacement");
  });

  it("none refuses every call plainly", async () => {
    const off = createBooksProvider("none", null, { db: env.DB, fetch, now: () => NOW, log: createLogger() });
    await expect(off.invoice("inv-1")).rejects.toThrow("Books is not connected here (BOOKS_PROVIDER is none)");
    const payment = { customerId: "c", amount: 1, date: "2026-09-21", reference: "r", description: "d", supply: "s" };
    await expect(off.recordPayment(payment)).rejects.toThrow("BOOKS_PROVIDER is none");
    await expect(off.upsertCustomer(CUSTOMER)).rejects.toThrow("BOOKS_PROVIDER is none");
    await expect(off.eraseCustomer("c")).rejects.toThrow("BOOKS_PROVIDER is none");
    await expect(off.items()).rejects.toThrow("BOOKS_PROVIDER is none");
  });
});
