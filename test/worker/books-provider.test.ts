// Zoho Books' adapter (src/providers/books.ts) on Books' documented answers, on a Zoho client of its own.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ZohoBooksSettings } from "../../src/config/settings.ts";
import { createLogger } from "../../src/log.ts";
import { createBooksProvider, createStubBooks } from "../../src/providers/books.ts";
import { NOW, captureLogs, fakeFetch, json } from "./helpers.ts";

const SETTINGS: ZohoBooksSettings = {
  clientId: "1000.BOOKSCLIENT",
  clientSecret: "books-client-secret",
  refreshToken: "1000.books-refresh",
  accountsHost: "accounts.zoho.in",
  apiHost: "www.zohoapis.in",
  orgId: "60088931635",
  refundAccountId: null,
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

describe("Books: invoices", () => {
  it("reads an invoice's number, date, total in paise and status, from the configured organisation", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1`]: () =>
        json({
          invoice: {
            invoice_id: "inv-1",
            invoice_number: "INV-000041",
            date: "2026-09-24",
            total: 2360.5,
            balance: 1000,
            status: "sent",
          },
        }),
    });
    expect(await books.invoice("inv-1")).toEqual({
      id: "inv-1",
      number: "INV-000041",
      date: "2026-09-24",
      total: 236050,
      balance: 100000,
      status: "sent",
    });
    expect(new URL(calls[1]?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
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

  // A discount code comes off the visit's line before tax (docs/decisions/0108-discount-codes.md), every other line
  // sent back as it was, since Books removes a line an update leaves out.
  it("takes a discount off a draft's dearest line before tax, and answers the invoice as it now stands", async () => {
    const draft = {
      invoice_id: "inv-1",
      invoice_number: "INV-000041",
      date: "2026-09-24",
      customer_id: "cust-1",
      total: 2050,
      status: "draft",
      line_items: [
        { line_item_id: "line-part", item_id: "item-base", rate: 50, quantity: 1 },
        { line_item_id: "line-visit", item_id: "item-service", rate: 2000, quantity: 1, tax_id: "tax-0" },
      ],
    };
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/invoices/inv-1`]: (call) =>
        call.method === "PUT" ? json({ invoice: { ...draft, total: 1850, balance: 1850 } }) : json({ invoice: draft }),
    });
    expect(await books.discountInvoice("inv-1", 20_000)).toMatchObject({
      id: "inv-1",
      total: 185_000,
      status: "draft",
    });
    const written = calls.find((call) => call.method === "PUT");
    expect(new URL(written?.url ?? "").searchParams.get("organization_id")).toBe("60088931635");
    expect(JSON.parse(written?.body ?? "{}")).toEqual({
      customer_id: "cust-1",
      discount_type: "item_level",
      is_discount_before_tax: true,
      line_items: [
        { line_item_id: "line-part", item_id: "item-base", rate: 50, quantity: 1 },
        {
          line_item_id: "line-visit",
          item_id: "item-service",
          rate: 2000,
          quantity: 1,
          tax_id: "tax-0",
          discount: 200,
        },
      ],
    });
  });
});

describe("Books: payments, receipts and refunds", () => {
  const body = (call: { body: string } | undefined) => JSON.parse(call?.body ?? "null") as unknown;

  it("records a payment in rupees, against the client's customer, and returns its ID", async () => {
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

  // Books' documented list shapes (ADR 0070); neither search has been tried on the org yet.
  it("finds a payment by our reference for the customer, matching the reference exactly", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () =>
        json({
          code: 0,
          customerpayments: [
            { payment_id: "bp-2", reference_number: "MM-2026-08410" },
            { payment_id: "bp-1", reference_number: "MM-2026-0841" },
          ],
        }),
    });
    expect(await books.findPayment("books-customer-9", "MM-2026-0841")).toBe("bp-1");
    const searched = new URL(calls[1]?.url ?? "");
    expect(calls[1]?.method).toBe("GET");
    expect(searched.searchParams.get("customer_id")).toBe("books-customer-9");
    expect(searched.searchParams.get("reference_number")).toBe("MM-2026-0841");
    expect(await books.findPayment("books-customer-9", "MM-2026-0999")).toBeNull();
  });

  it("finds a refund of a payment by Razorpay's refund ID, and answers null when there is none", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments/bp-1/refunds`]: () =>
        json({ code: 0, payment_refunds: [{ payment_refund_id: "br-1", reference_number: "rfnd_test7" }] }),
      [`${BOOKS_API}/customerpayments/bp-2/refunds`]: () => json({ code: 0, payment_refunds: [] }),
    });
    expect(await books.findRefund("bp-1", "rfnd_test7")).toBe("br-1");
    expect(await books.findRefund("bp-2", "rfnd_test7")).toBeNull();
  });

  it("fails loudly when Books refuses a payment", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/customerpayments`]: () => json({ code: 1002, message: "Customer does not exist." }, 400),
    });
    const payment = { customerId: "x", amount: 100, date: "2026-09-21", reference: "r", description: "d" };
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
    const payment = { customerId: "c", amount: 100, date: "2026-09-21", reference: "r", description: "d" };
    const recorded = await books.recordPayment(payment);
    expect(await new Response((await books.receiptPdf(recorded))?.body).text()).toMatch(/^%PDF-1\.4/);
    expect(await books.receiptPdf("real-1")).toBeNull();
    expect(books.made.payments).toEqual([payment]);
  });

  it("none refuses every call plainly", async () => {
    const off = createBooksProvider("none", null, { db: env.DB, fetch, now: () => NOW, log: createLogger() });
    await expect(off.invoice("inv-1")).rejects.toThrow("Books is not connected here (BOOKS_PROVIDER is none)");
    const payment = { customerId: "c", amount: 1, date: "2026-09-21", reference: "r", description: "d" };
    await expect(off.recordPayment(payment)).rejects.toThrow("BOOKS_PROVIDER is none");
  });
});
