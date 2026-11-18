// Books' own GST taxes (docs/decisions/0274-gst-on.md), read once a run and found by rate: within a state the GST
// group of the rate, which Books splits as CGST and SGST; across states, IGST at the rate.
//   GET /books/v3/settings/taxes                  { taxes }, under ZohoBooks.settings.READ

import { z } from "zod";
import type { BooksGst } from "./index.ts";
import type { BooksApi } from "./zoho.ts";
import { ZohoError } from "../zoho-http.ts";

const Taxes = z.object({
  taxes: z
    .array(
      z.object({
        tax_id: z.string(),
        tax_percentage: z.number(),
        tax_type: z.string(),
        tax_specific_type: z.string().nullish(),
      }),
    )
    .default([]),
});

type Tax = z.infer<typeof Taxes>["taxes"][number];

const fits = (tax: Tax, gst: BooksGst): boolean =>
  tax.tax_percentage === gst.percent &&
  (gst.intraState ? tax.tax_type === "tax_group" : tax.tax_specific_type === "igst");

/** Books' ID of the tax for a rate, its list read at the first ask; a refusal, told to ops at once, where it has none. */
export function taxFinder({ at, read }: BooksApi): (gst: BooksGst) => Promise<string> {
  let taxes: Promise<Tax[]> | null = null;
  return async (gst) => {
    taxes ??= read({ step: "taxes", path: at("/settings/taxes"), schema: Taxes, under: [] }).then(
      (found) => found.taxes,
      (error: unknown) => {
        taxes = null;
        throw error;
      },
    );
    const tax = (await taxes).find((each) => fits(each, gst));
    if (tax !== undefined) return tax.tax_id;
    const kind = gst.intraState ? "GST group" : "IGST tax";
    throw new ZohoError(0, "NO_TAX", `Books has no ${kind} at ${String(gst.percent)}%`, true);
  };
}
