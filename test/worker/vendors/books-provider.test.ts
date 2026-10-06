// Zoho Books' adapter (src/providers/books/zoho.ts) on a Zoho client of its own. Customers, invoices, items and the
// searches for a payment or a refund are read from answers the org gave (test/fixtures/vendors/books, recorded by
// scripts/staging/books-proof.ts and scripts/release/zoho-contract-probe.ts, with no one's details in them); the rest from Books'
// documentation.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { type NewBooksInvoice } from "../../../src/providers/books/index.ts";
import { captureLogs, json, type RecordedCall } from "../helpers.ts";
import contactAdded from "../../fixtures/vendors/books/contact-added.json";
import contactCrmLink from "../../fixtures/vendors/books/contact-crm-link.json";
import contactDeleted from "../../fixtures/vendors/books/contact-deleted.json";
import contactErased from "../../fixtures/vendors/books/contact-erased.json";
import contactGone from "../../fixtures/vendors/books/contact-gone.json";
import contactInUse from "../../fixtures/vendors/books/contact-in-use.json";
import contactInactive from "../../fixtures/vendors/books/contact-inactive.json";
import contactSaved from "../../fixtures/vendors/books/contact-saved.json";
import gstOff from "../../fixtures/vendors/books/gst-off.json";
import invoiceCreated from "../../fixtures/vendors/books/invoice-created.json";
import invoicesByReference from "../../fixtures/vendors/books/invoices-by-reference.json";
import {
  ZOHO_TOKEN_URL,
  BOOKS_API,
  tokenIssued,
  zohoBooks,
  sent,
  booksCalls,
  PERSON_ID,
  ADDRESS,
  CUSTOMER,
} from "./books-provider-fixtures.ts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
});

const pathOf = (call: RecordedCall | undefined) => new URL(call?.url ?? "").pathname;

const CUSTOMER_ID = contactAdded.contact.contact_id;

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

  it("reads the CRM Contact that Books' own CRM integration made of the customer, and only reads", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: () => json(contactCrmLink),
    });
    expect(await books.crmContactOf(CUSTOMER_ID)).toBe(contactCrmLink.contact.zcrm_contact_id);
    expect(booksCalls(calls).map((call) => call.method)).toEqual(["GET"]);
  });

  it("answers no CRM Contact for a customer not synced yet, or one Books no longer has", async () => {
    const unsynced = { ...contactCrmLink, contact: { ...contactCrmLink.contact, zcrm_contact_id: "" } };
    const reading = (answer: () => Response) =>
      zohoBooks({ [ZOHO_TOKEN_URL]: () => tokenIssued(), [`${BOOKS_API}/contacts/${CUSTOMER_ID}`]: answer }).books;

    expect(await reading(() => json(unsynced)).crmContactOf(CUSTOMER_ID)).toBeNull();
    expect(await reading(() => json(contactGone, 404)).crmContactOf(CUSTOMER_ID)).toBeNull();
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
