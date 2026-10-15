// Zoho Books' calls for what we buy (src/providers/books/zoho-purchases.ts; docs/decisions/0168-bills-in-books.md):
// a supplier's vendor found by its name or made with its GST treatment, currency and contact; and a receipt's bill
// found by our reference or made, its prices in the currency's main unit. Answers shaped as Books' documentation gives.

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewBooksVendor } from "../../../src/providers/books/index.ts";
import { json } from "../helpers.ts";
import { BOOKS_API, ZOHO_TOKEN_URL, booksCalls, sent, tokenIssued, zohoBooks } from "./books-provider-fixtures.ts";

const VENDOR: NewBooksVendor = {
  name: "Lumina Hair Co",
  gstin: null,
  currency: "USD",
  inIndia: false,
  gstOn: true,
  email: "orders@lumina.example",
  phone: null,
  paymentTermsDays: 30,
};

const vendorsFound = (contacts: { contact_id: string; contact_name: string }[]) =>
  json({ code: 0, message: "success", contacts });

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM zoho_access_tokens").run();
});

describe("Books: a supplier's vendor", () => {
  it("is the vendor Books holds under its exact name", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: () => vendorsFound([{ contact_id: "v-1", contact_name: "Lumina Hair Co" }]),
    });
    expect(await books.upsertVendor(VENDOR)).toBe("v-1");
    expect(booksCalls(calls)).toHaveLength(1);
    expect(new URL(booksCalls(calls)[0]?.url ?? "").searchParams.get("contact_type")).toBe("vendor");
  });

  it("is made overseas in its currency, with its contact, where Books holds only a near name", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: (call) =>
        call.method === "POST"
          ? json({ code: 0, message: "The contact has been added.", contact: { contact_id: "v-2" } })
          : vendorsFound([{ contact_id: "v-9", contact_name: "Lumina Hair Company" }]),
      [`${BOOKS_API}/settings/currencies`]: () =>
        json({ code: 0, currencies: [{ currency_id: "cur-usd", currency_code: "USD" }] }),
    });
    expect(await books.upsertVendor(VENDOR)).toBe("v-2");
    expect(sent(booksCalls(calls).at(-1))).toEqual({
      contact_name: "Lumina Hair Co",
      contact_type: "vendor",
      gst_treatment: "overseas",
      currency_id: "cur-usd",
      payment_terms: 30,
      contact_persons: [{ email: "orders@lumina.example", is_primary_contact: true }],
    });
  });

  it("is made in India as registered with its GSTIN, or unregistered without one, in rupees", async () => {
    const made: unknown[] = [];
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: (call) => {
        if (call.method !== "POST") return vendorsFound([]);
        made.push(JSON.parse(call.body));
        return json({ code: 0, contact: { contact_id: `v-${String(made.length)}` } });
      },
    });
    const indian = { ...VENDOR, currency: "INR", inIndia: true, email: null };
    await books.upsertVendor({ ...indian, gstin: "06AAACM1234A1Z5" });
    await books.upsertVendor({ ...indian, phone: "+911244000000" });
    expect(made).toEqual([
      expect.objectContaining({ gst_treatment: "business_gst", gst_no: "06AAACM1234A1Z5" }),
      expect.objectContaining({
        gst_treatment: "business_none",
        contact_persons: [{ phone: "+911244000000", is_primary_contact: true }],
      }),
    ]);
    expect(made[0]).not.toHaveProperty("currency_id");
    expect(made[0]).not.toHaveProperty("contact_persons");
    expect(booksCalls(calls).some((call) => call.url.includes("/settings/currencies"))).toBe(false);
  });

  it("is made with no GST treatment while GST is off in the org, which Books would refuse", async () => {
    const made: unknown[] = [];
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/contacts`]: (call) => {
        if (call.method !== "POST") return vendorsFound([]);
        made.push(JSON.parse(call.body));
        return json({ code: 0, contact: { contact_id: "v-1" } });
      },
    });
    await books.upsertVendor({ ...VENDOR, currency: "INR", inIndia: true, gstOn: false });
    expect(made[0]).not.toHaveProperty("gst_treatment");
  });
});

describe("Books: a receipt's bill", () => {
  it("is found by our reference, and only by it", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/bills`]: (call) =>
        new URL(call.url).searchParams.get("reference_number") === "receipt-1"
          ? json({ code: 0, bills: [{ bill_id: "b-1", reference_number: "receipt-1" }] })
          : json({ code: 0, bills: [{ bill_id: "b-7", reference_number: "receipt-10" }] }),
    });
    expect(await books.findBill("receipt-1")).toEqual({ id: "b-1", reference: "receipt-1" });
    expect(await books.findBill("receipt-2")).toBeNull();
  });

  it("is made on its vendor, each line's price in the currency's main unit", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/bills`]: () => json({ code: 0, bill: { bill_id: "b-2", reference_number: "" } }),
    });
    const bill = await books.createBill({
      vendorId: "v-1",
      reference: "receipt-1",
      billNumber: "LUM-2209",
      date: "2026-09-21",
      dueDate: "2026-10-21",
      exchangeRate: 83.25,
      currency: "USD",
      lines: [{ description: "Solvent (PO-0001)", accountId: "acc-raw", unitPrice: 250, quantity: 10 }],
    });
    expect(bill).toEqual({ id: "b-2", reference: null });
    expect(sent(booksCalls(calls)[0])).toEqual({
      vendor_id: "v-1",
      bill_number: "LUM-2209",
      reference_number: "receipt-1",
      date: "2026-09-21",
      due_date: "2026-10-21",
      exchange_rate: 83.25,
      line_items: [{ description: "Solvent (PO-0001)", account_id: "acc-raw", rate: 2.5, quantity: 10 }],
    });
  });
});

describe("Books: a claim's vendor credit", () => {
  it("is found by our reference, and only by it", async () => {
    const { books } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/vendorcredits`]: (call) =>
        new URL(call.url).searchParams.get("reference_number") === "claim-1"
          ? json({ code: 0, vendor_credits: [{ vendor_credit_id: "vc-1", reference_number: "claim-1" }] })
          : json({ code: 0, vendor_credits: [] }),
    });
    expect(await books.findVendorCredit("claim-1")).toEqual({ id: "vc-1", reference: "claim-1" });
    expect(await books.findVendorCredit("claim-2")).toBeNull();
  });

  it("is made on its vendor under our claim's number, its line's price in the currency's main unit", async () => {
    const { books, calls } = zohoBooks({
      [ZOHO_TOKEN_URL]: () => tokenIssued(),
      [`${BOOKS_API}/vendorcredits`]: () =>
        json({ code: 0, vendor_credit: { vendor_credit_id: "vc-2", reference_number: "claim-1" } }),
    });
    const credit = await books.createVendorCredit({
      vendorId: "v-1",
      reference: "claim-1",
      creditNumber: "CL-0001",
      date: "2026-10-01",
      exchangeRate: 83.25,
      currency: "USD",
      lines: [{ description: "Solvent (CL-0001, PO-0001)", accountId: "acc-raw", unitPrice: 400, quantity: 1 }],
    });
    expect(credit).toEqual({ id: "vc-2", reference: "claim-1" });
    expect(new URL(booksCalls(calls)[0]?.url ?? "").searchParams.get("ignore_auto_number_generation")).toBe("true");
    expect(sent(booksCalls(calls)[0])).toEqual({
      vendor_id: "v-1",
      vendor_credit_number: "CL-0001",
      reference_number: "claim-1",
      date: "2026-10-01",
      exchange_rate: 83.25,
      line_items: [{ description: "Solvent (CL-0001, PO-0001)", account_id: "acc-raw", rate: 4, quantity: 1 }],
    });
  });
});
