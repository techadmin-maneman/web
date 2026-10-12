// What we buy, in Zoho Books (docs/decisions/0168-bills-in-books.md): each supplier a vendor, found again by its name,
// and each receipt a bill of what the supplier invoiced, found again by our receipt's reference before another is made.
// Calls under ZohoBooks.contacts and ZohoBooks.bills (docs/provisioning.md).

import { z } from "zod";
import type { BooksBill, BooksProvider, NewBooksBill, NewBooksVendor } from "./index.ts";
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

const billOf = (bill: z.infer<typeof Bill>): BooksBill => ({
  id: bill.bill_id,
  reference: bill.reference_number === undefined || bill.reference_number === "" ? null : bill.reference_number,
});

/** A vendor's GST treatment, as Books names it: registered, unregistered, or overseas. */
function gstTreatment(vendor: NewBooksVendor): string {
  if (!vendor.inIndia) return "overseas";
  return vendor.gstin === null ? "business_none" : "business_gst";
}

export function purchaseCalls({ at, read }: BooksApi): Pick<BooksProvider, "upsertVendor" | "findBill" | "createBill"> {
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
            gst_treatment: gstTreatment(vendor),
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
            line_items: bill.lines.map((line) => ({
              description: line.description,
              account_id: line.accountId,
              rate: line.unitPrice / 100,
              quantity: line.quantity,
            })),
          },
        },
      });
      return billOf(made);
    },
  };
}
