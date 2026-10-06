// Zoho Books' adapter (src/providers/books/zoho.ts) on a Zoho client of its own. Customers, invoices, items and the
// searches for a payment or a refund are read from answers the org gave (test/fixtures/vendors/books, recorded by
// scripts/staging/books-proof.ts and scripts/release/zoho-contract-probe.ts, with no one's details in them); the rest from Books'
// documentation.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/log.ts";
import { BOOKS_ITEM_PAGES, createBooksProvider, type NewBooksInvoice } from "../../../src/providers/books/index.ts";
import { createStubBooks } from "../../../src/providers/books/stub.ts";
import { NOW, json } from "../helpers.ts";
import invoiceCreated from "../../fixtures/vendors/books/invoice-created.json";
import itemAdded from "../../fixtures/vendors/books/item-added.json";
import itemSaved from "../../fixtures/vendors/books/item-saved.json";
import itemsPage from "../../fixtures/vendors/books/items-page.json";
import paymentsByReference from "../../fixtures/vendors/books/payments-by-reference.json";
import refundsOfPayment from "../../fixtures/vendors/books/refunds-of-payment.json";
import {
  ZOHO_TOKEN_URL,
  BOOKS_API,
  tokenIssued,
  zohoBooks,
  sent,
  booksCalls,
  CUSTOMER,
} from "./books-provider-fixtures.ts";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
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
