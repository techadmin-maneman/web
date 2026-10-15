// What we buy, in Zoho Books (docs/decisions/0168-bills-in-books.md): each supplier a vendor, found again by its name,
// each receipt a bill of what the supplier invoiced, and each claim credited a vendor credit, each found again by our
// reference before another is made. Calls under ZohoBooks.contacts, .bills and .debitnotes (docs/provisioning.md).

import { minorUnitDigits } from "../../config/currencies.ts";
import { z } from "zod";
import type { BooksBill, BooksProvider, NewBooksBill, NewBooksVendor, NewBooksVendorCredit } from "./index.ts";
import type { BooksApi } from "./zoho.ts";

const VendorsFound = z.object({
  contacts: z.array(z.object({ contact_id: z.string(), contact_name: z.string() })).default([]),
});
const Currencies = z.object({
  currencies: z.array(z.object({ currency_id: z.string(), currency_code: z.string() })).default([]),
});
const Contact = z.object({ contact_id: z.string() });
const Bill = z.object({ bill_id: z.string(), reference_number: z.string().nullish() });
const BillsFound = z.object({ bills: z.array(Bill).default([]) });
const Credit = z.object({ vendor_credit_id: z.string(), reference_number: z.string().nullish() });
const CreditsFound = z.object({ vendor_credits: z.array(Credit).default([]) });

const referenceOf = (reference: string | null | undefined) => (reference === "" ? null : (reference ?? null));
const billOf = (bill: z.infer<typeof Bill>): BooksBill => ({
  id: bill.bill_id,
  reference: referenceOf(bill.reference_number),
});
const creditOf = (credit: z.infer<typeof Credit>): BooksBill => ({
  id: credit.vendor_credit_id,
  reference: referenceOf(credit.reference_number),
});

/** A bill's or a credit's lines as Books takes them: each price in the currency's main unit, whatever its decimals. */
const lineItems = (lines: NewBooksBill["lines"], currency: string) =>
  lines.map((line) => ({
    description: line.description,
    account_id: line.accountId,
    rate: line.unitPrice / 10 ** minorUnitDigits(currency),
    quantity: line.quantity,
  }));

/** A vendor's GST treatment, as Books names it: registered, unregistered, or overseas. */
function gstTreatment(vendor: NewBooksVendor): string {
  if (!vendor.inIndia) return "overseas";
  return vendor.gstin === null ? "business_none" : "business_gst";
}

type PurchaseCalls = "upsertVendor" | "findBill" | "createBill" | "findVendorCredit" | "createVendorCredit";

export function purchaseCalls(api: BooksApi): Pick<BooksProvider, PurchaseCalls> {
  const { at, read } = api;
  /** Books' ID for a currency it has enabled; null for rupees, its own, or one it has not. */
  async function currencyId(code: string): Promise<string | null> {
    if (code === "INR") return null;
    const found = await read({ step: "currencies", path: at("/settings/currencies"), schema: Currencies, under: [] });
    return found.currencies.find((currency) => currency.currency_code === code)?.currency_id ?? null;
  }

  return {
    async upsertVendor(vendor) {
      const query = `&contact_type=vendor&contact_name=${encodeURIComponent(vendor.name)}`;
      const found = await read({ step: "find_vendor", path: at("/contacts", query), schema: VendorsFound, under: [] });
      const ours = found.contacts.find((contact) => contact.contact_name === vendor.name);
      if (ours !== undefined) return ours.contact_id;
      const currency = await currencyId(vendor.currency);
      const made = await read({
        step: "create_vendor",
        path: at("/contacts"),
        schema: Contact,
        under: ["contact"],
        write: {
          method: "POST",
          body: {
            contact_name: vendor.name,
            contact_type: "vendor",
            ...(vendor.gstOn ? { gst_treatment: gstTreatment(vendor) } : {}),
            ...(vendor.gstin === null ? {} : { gst_no: vendor.gstin }),
            ...(currency === null ? {} : { currency_id: currency }),
            payment_terms: vendor.paymentTermsDays,
            ...(vendor.email === null && vendor.phone === null
              ? {}
              : {
                  contact_persons: [
                    {
                      ...(vendor.email === null ? {} : { email: vendor.email }),
                      ...(vendor.phone === null ? {} : { phone: vendor.phone }),
                      is_primary_contact: true,
                    },
                  ],
                }),
          },
        },
      });
      return made.contact_id;
    },
    ...documentCalls(api),
  };
}

/** Bills and vendor credits, each found by our reference before one is made. */
function documentCalls({ at, read }: BooksApi): Pick<BooksProvider, Exclude<PurchaseCalls, "upsertVendor">> {
  return {
    async findBill(reference) {
      const query = `&reference_number=${encodeURIComponent(reference)}`;
      const found = await read({ step: "find_bill", path: at("/bills", query), schema: BillsFound, under: [] });
      const ours = found.bills.find((bill) => bill.reference_number === reference);
      return ours === undefined ? null : billOf(ours);
    },

    async createBill(bill: NewBooksBill) {
      const made = await read({
        step: "create_bill",
        path: at("/bills"),
        schema: Bill,
        under: ["bill"],
        write: {
          method: "POST",
          body: {
            vendor_id: bill.vendorId,
            bill_number: bill.billNumber,
            reference_number: bill.reference,
            date: bill.date,
            due_date: bill.dueDate,
            exchange_rate: bill.exchangeRate,
            line_items: lineItems(bill.lines, bill.currency),
          },
        },
      });
      return billOf(made);
    },

    async findVendorCredit(reference) {
      const query = `&reference_number=${encodeURIComponent(reference)}`;
      const found = await read({
        step: "find_credit",
        path: at("/vendorcredits", query),
        schema: CreditsFound,
        under: [],
      });
      const ours = found.vendor_credits.find((credit) => credit.reference_number === reference);
      return ours === undefined ? null : creditOf(ours);
    },

    async createVendorCredit(credit: NewBooksVendorCredit) {
      const made = await read({
        step: "create_credit",
        path: at("/vendorcredits"),
        schema: Credit,
        under: ["vendor_credit"],
        write: {
          method: "POST",
          body: {
            vendor_id: credit.vendorId,
            reference_number: credit.reference,
            date: credit.date,
            exchange_rate: credit.exchangeRate,
            line_items: lineItems(credit.lines, credit.currency),
          },
        },
      });
      return creditOf(made);
    },
  };
}
