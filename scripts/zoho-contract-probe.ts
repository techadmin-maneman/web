// Checks, before every release, that Zoho still answers the way our adapters read it. Every read the Books and CRM
// adapters make runs through the adapter itself against the owner's org, so each answer is read by the adapter's own
// schema. Read-only: it changes nothing in Zoho.
//
//   node --env-file=.env.books-scripts --env-file=.env.crm-scripts scripts/zoho-contract-probe.ts [--record]
//
// The files hold each client's ID, secret and hosts, ZOHO_BOOKS_ORG_ID, and the scripts' own refresh tokens,
// ZOHO_BOOKS_SCRIPTS_REFRESH_TOKEN and ZOHO_SCRIPTS_REFRESH_TOKEN (scripts/lib/zoho-script-token.ts). The CRM's needs
// ZohoCRM.modules.leads.READ and ZohoSearch.securesearch.READ. No secret is printed. A run makes about 15 calls.
//
// --record writes the answers the adapter tests load to test/fixtures/vendors, with no one's details in them. A read
// with nothing in the org to read is skipped, and says so; any other failure fails the run.

import { parseArgs } from "node:util";
import { NO_GST } from "../src/config/gst.ts";
import type { ZohoBooksSettings, ZohoSettings } from "../src/config/settings.ts";
import { createBooksProvider, type BooksPdf } from "../src/providers/books.ts";
import { createZohoLeadFinder } from "../src/providers/zoho-crm.ts";
import { createZohoRequester } from "../src/providers/zoho-http.ts";
import { writeFixture } from "./lib/vendor-fixtures.ts";
import { callLogger, tokenTable } from "./lib/zoho-script-deps.ts";
import { refreshTokenForScript } from "./lib/zoho-script-token.ts";

// --use-worker-token is read by refreshTokenForScript; it is named here so the parser takes it.
const { values } = parseArgs({
  options: {
    record: { type: "boolean", default: false },
    "use-worker-token": { type: "boolean", default: false },
  },
});

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    console.error(`${name} is not set; pass the secrets files with --env-file`);
    process.exit(2);
  }
  return value;
}

const booksSettings: ZohoBooksSettings = {
  clientId: required("ZOHO_BOOKS_CLIENT_ID"),
  clientSecret: required("ZOHO_BOOKS_CLIENT_SECRET"),
  refreshToken: refreshTokenForScript("books"),
  accountsHost: required("ZOHO_BOOKS_ACCOUNTS_HOST"),
  apiHost: required("ZOHO_BOOKS_API_HOST"),
  orgId: required("ZOHO_BOOKS_ORG_ID"),
  refundAccountId: null,
  gst: NO_GST,
};

const crmSettings: ZohoSettings = {
  clientId: required("ZOHO_CLIENT_ID"),
  clientSecret: required("ZOHO_CLIENT_SECRET"),
  refreshToken: refreshTokenForScript("crm"),
  accountsHost: required("ZOHO_ACCOUNTS_HOST"),
  apiHost: required("ZOHO_API_HOST"),
  larId: null,
};

// ---------------------------------------------------------------------------
// Each call's answer, kept for --record
// ---------------------------------------------------------------------------

/** The JSON of the last answer an API host gave; null for an empty answer or a file. */
let lastAnswer: unknown = null;

async function jsonOf(response: Response): Promise<unknown> {
  const type = response.headers.get("Content-Type") ?? "";
  return type.includes("json") ? response.json() : null;
}

const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const isTokenCall = response.url.includes("/oauth/v2/token");
  if (!isTokenCall) lastAnswer = await jsonOf(response.clone());
  return response;
};

const callsMade: string[] = [];
const deps = { db: tokenTable(), fetch: recordingFetch, now: () => new Date(), log: callLogger(callsMade) };

const books = createBooksProvider("zoho", booksSettings, deps);
const booksRequest = createZohoRequester("books", booksSettings, deps);
const findLead = createZohoLeadFinder(crmSettings, deps);
const crmRequest = createZohoRequester("crm", crmSettings, deps);

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

class Skipped extends Error {}

/** Ends a check as skipped: the org holds nothing for it to read. */
function skip(why: string): never {
  throw new Skipped(why);
}

/** Ends a check as failed unless `holds`. */
function expectThat(holds: boolean, what: string): void {
  if (!holds) throw new Error(what);
}

interface Fixture {
  readonly vendor: "books" | "crm";
  readonly name: string;
}

const recorded: string[] = [];

/**
 * Runs one check and prints its line. The adapter call a check is about comes last in it, so the answer kept is that
 * call's, and with --record a passing check writes it to its fixture.
 */
async function check(name: string, work: () => Promise<string>, fixture?: Fixture): Promise<void> {
  lastAnswer = null;
  try {
    const detail = await work();
    console.log(`PASS  ${name}: ${detail}`);
    if (values.record && fixture !== undefined) {
      recorded.push(await writeFixture(fixture.vendor, fixture.name, lastAnswer));
    }
  } catch (error) {
    if (error instanceof Skipped) {
      console.log(`SKIP  ${name}: ${error.message}`);
      return;
    }
    process.exitCode = 1;
    console.log(`FAIL  ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function isPdf(pdf: BooksPdf | null): Promise<boolean> {
  if (pdf === null) return false;
  return (await new Response(pdf.body).text()).startsWith("%PDF");
}

/** A reference no record has, which a search must answer with nothing. */
const noSuchReference = () => `contract-probe-${crypto.randomUUID()}`;

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

const org = `organization_id=${encodeURIComponent(booksSettings.orgId)}`;

interface InvoiceListed {
  readonly invoice_id: string;
  readonly reference_number?: string;
}

interface PaymentListed {
  readonly payment_id: string;
  readonly customer_id: string;
  readonly reference_number?: string;
  readonly bcy_refunded_amount?: number;
}

interface RefundListed {
  readonly payment_refund_id: string;
  readonly reference_number?: string;
}

/** The first ten invoices or payments Books lists, to give the adapter's reads something real to read. */
async function firstListed<T>(path: string, under: string): Promise<T[]> {
  const response = await booksRequest("discover", `/books/v3${path}?${org}&per_page=10`);
  const answer = await response.json<Record<string, T[] | undefined>>();
  return answer[under] ?? [];
}

/** The first of the records listed that carries a reference, else the first. */
function withReference<T extends { readonly reference_number?: string }>(listed: readonly T[]): T | undefined {
  return listed.find((each) => (each.reference_number ?? "") !== "") ?? listed[0];
}

async function probeBooksInvoices(): Promise<void> {
  let invoice: InvoiceListed | undefined;
  await check("books: invoices to read", async () => {
    invoice = withReference(await firstListed<InvoiceListed>("/invoices", "invoices"));
    return invoice === undefined ? "none in the org" : "found";
  });

  await check(
    "books invoice",
    async () => {
      if (invoice === undefined) skip("no invoice to read");
      const read = await books.invoice(invoice.invoice_id);
      expectThat(read !== null, "an invoice the org lists was not found");
      return `${String(read?.number)}, ${String(read?.status)}`;
    },
    { vendor: "books", name: "invoice" },
  );

  await check("books invoice_pdf", async () => {
    if (invoice === undefined) skip("no invoice to read");
    expectThat(await isPdf(await books.invoicePdf(invoice.invoice_id)), "the answer is not a PDF");
    return "a PDF";
  });

  await check("books find_invoice, a reference it holds", async () => {
    const reference = invoice?.reference_number ?? "";
    if (reference === "") skip("no invoice with a reference to find");
    const found = await books.findInvoice(reference);
    expectThat(found?.id === invoice?.invoice_id, "the invoice was not found by its reference");
    return "found by its reference";
  });

  await check("books find_invoice, a reference it does not hold", async () => {
    expectThat((await books.findInvoice(noSuchReference())) === null, "an invoice was found for a new reference");
    return "nothing";
  });
}

/** A refund of the payment that carries a reference; undefined when it has none. */
async function aRefundOf(paymentId: string): Promise<RefundListed | undefined> {
  const response = await booksRequest("discover", `/books/v3/customerpayments/${paymentId}/refunds?${org}`);
  const { payment_refunds: refunds = [] } = await response.json<{ payment_refunds?: RefundListed[] }>();
  return refunds.find((refund) => (refund.reference_number ?? "") !== "");
}

async function probeBooksPayments(): Promise<void> {
  let payments: PaymentListed[] = [];
  await check("books: payments to read", async () => {
    payments = await firstListed<PaymentListed>("/customerpayments", "customerpayments");
    return `${String(payments.length)} listed`;
  });
  const payment = withReference(payments);
  const refunded = payments.find((each) => (each.bcy_refunded_amount ?? 0) > 0);

  await check(
    "books find_payment",
    async () => {
      const reference = payment?.reference_number ?? "";
      if (payment === undefined || reference === "") skip("no payment with a reference to find");
      const found = await books.findPayment(payment.customer_id, reference);
      expectThat(found === payment.payment_id, "the payment was not found by its customer and reference");
      return "found by its customer and reference";
    },
    { vendor: "books", name: "payments-by-reference" },
  );

  await check("books receipt_pdf", async () => {
    if (payment === undefined) skip("no payment to read");
    expectThat(await isPdf(await books.receiptPdf(payment.payment_id)), "the answer is not a PDF");
    return "a PDF";
  });

  await check(
    "books find_refund, a refund it holds",
    async () => {
      if (refunded === undefined) skip("no refunded payment to read");
      const refund = await aRefundOf(refunded.payment_id);
      if (refund === undefined) skip("no refund with a reference to find");
      const found = await books.findRefund(refunded.payment_id, refund.reference_number ?? "");
      expectThat(found === refund.payment_refund_id, "the refund was not found by its reference");
      return "found by its reference";
    },
    { vendor: "books", name: "refunds-of-payment" },
  );

  await check("books find_refund, a reference it does not hold", async () => {
    if (payment === undefined) skip("no payment to read");
    expectThat((await books.findRefund(payment.payment_id, noSuchReference())) === null, "a refund was found");
    return "nothing";
  });
}

async function probeBooksItems(): Promise<void> {
  await check("books items", async () => `${String((await books.items()).length)} items`);
}

// ---------------------------------------------------------------------------
// The CRM
// ---------------------------------------------------------------------------

interface LeadListed {
  readonly id: string;
  readonly D1_Person_ID?: string | null;
}

/** A Lead the sync made, which carries our person ID; undefined when the CRM holds none. */
async function aLeadWeMade(): Promise<LeadListed | undefined> {
  const response = await crmRequest("discover", "/crm/v8/Leads?fields=D1_Person_ID&per_page=10");
  if (response.status === 204) return undefined;
  const { data = [] } = await response.json<{ data?: LeadListed[] }>();
  return data.find((lead) => (lead.D1_Person_ID ?? "") !== "");
}

async function probeCrm(): Promise<void> {
  await check(
    "crm search, a person it has",
    async () => {
      const lead = await aLeadWeMade();
      const personId = lead?.D1_Person_ID ?? "";
      if (lead === undefined || personId === "") skip("no Lead with a person ID to find");
      expectThat((await findLead(personId)) === lead.id, "the Lead was not found by its person ID");
      return "found by the person ID";
    },
    { vendor: "crm", name: "lead-search" },
  );

  await check("crm search, a person it does not have", async () => {
    expectThat((await findLead(crypto.randomUUID())) === null, "a Lead was found for a new person ID");
    return "nothing";
  });
}

try {
  await probeBooksItems();
  await probeBooksInvoices();
  await probeBooksPayments();
  await probeCrm();
} finally {
  console.log(`\nCalls made: ${callsMade.join(", ")}`);
  if (recorded.length > 0) console.log(`Recorded, scrubbed: ${recorded.join(", ")}`);
}
