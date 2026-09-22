// Zoho Books, for the invoices and receipts a client sees in the app
// (docs/decisions/0032-fsm-mirror.md). Documents are read from Books when a
// client opens one, never copied. It shares the FSM client's Zoho token.
//
//   GET /books/v3/invoices/{id}?organization_id=              { invoice: {...} }
//   GET /books/v3/invoices/{id}?organization_id=&accept=pdf   the PDF

import { z } from "zod";
import type { ZohoFsmSettings } from "../config/settings.ts";
import type { Logger } from "../log.ts";
import { createZohoFsmClient } from "./fsm-zoho.ts";
import { ZohoError } from "./zoho-http.ts";

export interface BooksInvoice {
  readonly id: string;
  /** Books' own number, e.g. "INV-000041". */
  readonly number: string;
  /** India's calendar date, YYYY-MM-DD. */
  readonly date: string;
  /** In paise. */
  readonly total: number;
  /** Books' status word: draft, sent, paid, void and so on. */
  readonly status: string;
}

export interface BooksPdf {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: "application/pdf";
}

export interface BooksProvider {
  invoice(id: string): Promise<BooksInvoice | null>;
  /** Null while Books has no such invoice, which the app shows as "Document unavailable". */
  invoicePdf(id: string): Promise<BooksPdf | null>;
}

interface Dependencies {
  readonly db: D1Database;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  readonly log: Logger;
}

export function createBooksProvider(
  provider: string | undefined,
  settings: ZohoFsmSettings | null,
  deps: Dependencies,
): BooksProvider {
  if (provider === "zoho" && settings !== null && settings.booksOrgId !== null) {
    return createZohoBooks(settings, settings.booksOrgId, deps);
  }
  if (provider === "stub") return createStubBooks();
  const off = () => Promise.reject(new Error("Books is not connected here (BOOKS_PROVIDER is none)"));
  return { invoice: off, invoicePdf: off };
}

const Invoice = z.object({
  invoice_id: z.string(),
  invoice_number: z.string(),
  date: z.string(),
  total: z.number(),
  status: z.string(),
});

function createZohoBooks(settings: ZohoFsmSettings, orgId: string, deps: Dependencies): BooksProvider {
  const request = createZohoFsmClient(settings, deps);
  const path = (id: string, extra = "") =>
    `/books/v3/invoices/${encodeURIComponent(id)}?organization_id=${encodeURIComponent(orgId)}${extra}`;

  /** Books answers 404 for an invoice it does not have; that is "unavailable", not a failure. */
  async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ZohoError && error.status === 404) return null;
      throw error;
    }
  }

  return {
    invoice: (id) =>
      orNull(async () => {
        const answer = await (await request("invoice", path(id))).json<{ invoice?: unknown }>();
        const invoice = Invoice.parse(answer.invoice);
        return {
          id: invoice.invoice_id,
          number: invoice.invoice_number,
          date: invoice.date,
          total: Math.round(invoice.total * 100),
          status: invoice.status,
        };
      }),
    invoicePdf: (id) =>
      orNull(async () => {
        const response = await request("invoice_pdf", path(id, "&accept=pdf"));
        if (response.body === null) throw new ZohoError(response.status, "EMPTY_FILE", "the PDF came back empty");
        return { body: response.body, contentType: "application/pdf" as const };
      }),
  };
}

/** The smallest valid PDF: one blank page. The stub's every document. */
const BLANK_PDF =
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";

/** Local and test stand-in: every invoice ID starting "stub-" exists, as a blank page. */
export function createStubBooks(): BooksProvider {
  return {
    invoice: (id) =>
      Promise.resolve(
        id.startsWith("stub-")
          ? { id, number: `INV-${id.slice(5).padStart(6, "0")}`, date: "2026-09-22", total: 0, status: "draft" }
          : null,
      ),
    invoicePdf: (id) =>
      Promise.resolve(
        id.startsWith("stub-")
          ? { body: new Response(BLANK_PDF).body ?? new ReadableStream(), contentType: "application/pdf" as const }
          : null,
      ),
  };
}
