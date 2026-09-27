// The client app's payments and documents (docs/prompts/phase2-backend.md,
// "Read endpoints"), from the payments mirror (docs/decisions/0044-payments-mirror.md)
// and Zoho Books (docs/decisions/0032-fsm-mirror.md).
//
//   GET /api/payments                one list of payments and refunds, newest first
//   GET /api/payments/:id            one entry: a payment with its documents, or a refund with its destination
//   GET /api/payments/:id/receipt    a payment's receipt, as a PDF from Books
//   GET /api/documents/:id           a visit's invoice, as a PDF from Books
//
// Amounts are in paise, as Razorpay charged them, GST included; each carries
// its ex-GST part, which the app shows as the main figure, at the rate it was
// sold at: the hold's, kept on the payment when it was captured. A payment no
// hold priced is split at GST_PERCENT. A failed attempt is not a payment and
// is left out. A payment kept under the 24-hour rule is a
// charge, and carries its evidence (docs/decisions/0046-moving-and-cancelling.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import {
  CREDIT_EVENTS,
  creditLines,
  issuedInvoiceOf,
  paymentEntries,
  paymentEntry,
  receiptOf,
} from "../domain/client-payments.ts";
import { clientOf, requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { NoShowNoteSchema } from "./client-visits.ts";

const VisitRefSchema = z
  .union([
    z.object({ id: z.uuid(), date: z.iso.date(), type: z.union([z.enum(VISIT_TYPES), z.null()]) }).strict(),
    z.null(),
  ])
  .openapi({ description: "The visit it paid for, when known." });

const money = {
  date: z.iso.date().openapi({ description: "India's calendar date it was made." }),
  amount: z.number().int().openapi({ description: "In paise, GST included." }),
  amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST: the main figure." }),
  gst_percent: z.number().openapi({ description: "The GST rate the amount includes." }),
  visit: VisitRefSchema,
};

const PaymentEntrySchema = z
  .object({
    kind: z.literal("payment"),
    id: z.uuid(),
    ...money,
    status: z.enum(["authorized", "captured", "refunded", "partially_refunded"]),
    method: z.union([z.string(), z.null()]).openapi({ description: "upi, card, netbanking and so on." }),
    reference: z.union([z.string(), z.null()]).openapi({ description: "Ours, e.g. MM-2026-0841, once captured." }),
    refunded_amount: z.number().int().openapi({ description: "In paise: refunds Razorpay has processed." }),
    purpose: z.enum(["visit", "late_fee"]).openapi({ description: "What it paid for: the visit, or a late fee." }),
    charge: z
      .union([
        z
          .object({
            change: z.enum(["cancelled", "moved"]),
            at: z.iso.datetime().openapi({ description: "When the client cancelled or moved the visit." }),
            visit_started_at: z.iso.datetime().openapi({ description: "When the visit was to start." }),
            amount: z.number().int().openapi({ description: "In paise: what was kept." }),
          })
          .strict(),
        z.null(),
      ])
      .openapi({
        description: 'Kept under the 24-hour rule, with its evidence: "cancelled 9:14 am, visit was 10 am".',
      }),
    no_show: z.union([NoShowNoteSchema, z.null()]).openapi({
      description:
        "The visit it paid for was one the client was not home for: how long we waited, and what ops ruled (LIFE-07).",
    }),
  })
  .strict()
  .openapi("PaymentEntry");

const RefundEntrySchema = z
  .object({
    kind: z.literal("refund"),
    id: z.uuid(),
    payment_id: z.uuid(),
    ...money,
    status: z.enum(["created", "processed", "failed"]),
    destination: z
      .union([z.string(), z.null()])
      .openapi({ description: "Where the money goes back to: the payment's method." }),
    speed: z.union([z.string(), z.null()]).openapi({ description: "normal (5 to 7 working days) or instant." }),
  })
  .strict()
  .openapi("RefundEntry");

export const EntrySchema = z.discriminatedUnion("kind", [PaymentEntrySchema, RefundEntrySchema]);

/** What happened to the client's service-visit credits, entry by entry, as the ledger keeps them. */
const CreditLineSchema = z
  .object({
    id: z.string().openapi({ description: "The ledger entry's." }),
    date: z.iso.date().openapi({ description: "India's calendar date it was made." }),
    event: z.enum(CREDIT_EVENTS).openapi({
      description:
        "added: a grant (a friend fitted, ops, the import); used: a visit it paid for; lost: one it paid for that " +
        "was cancelled inside 24 hours, or that the client was not home for and ops charged; returned: back after a " +
        "cancel in time; expired; withdrawn: clawed back under the guarantee; corrected: taken off by ops by hand.",
    }),
    visits: z.number().int().openapi({ description: "Signed: what it added to the balance, or took from it." }),
    visit: VisitRefSchema,
    source: z
      .union([z.enum(["referral", "ops", "import"]), z.null()])
      .openapi({ description: "Where credits added came from; null for any other entry." }),
    no_show: z.union([NoShowNoteSchema, z.null()]),
  })
  .strict()
  .openapi("CreditLine");

const PaymentDetailSchema = PaymentEntrySchema.extend({
  documents: z
    .object({
      invoice: z
        .union([z.uuid(), z.null()])
        .openapi({ description: "The visit's tax invoice, for GET /api/documents/{id}, once Books has issued it." }),
      receipt: z.union([z.uuid(), z.null()]).openapi({
        description:
          "The payment's receipt, for GET /api/payments/{id}/receipt, once the payment is recorded in Books.",
      }),
    })
    .strict(),
}).openapi("PaymentDetail");

const RefundDetailSchema = RefundEntrySchema.extend({
  voucher: z
    .null()
    .openapi({ description: "The refund voucher; arrives with the invoicing route (docs/open-points.md, item 3)." }),
}).openapi("RefundDetail");

const paymentsRoute = createRoute({
  method: "get",
  path: "/api/payments",
  summary: "The client's payments and refunds, newest first",
  responses: {
    200: {
      description: "One list of payments and refunds, and one of the credits' changes",
      content: {
        "application/json": {
          schema: z
            .object({
              entries: z.array(EntrySchema),
              credits: z.array(CreditLineSchema).openapi({
                description:
                  "Every change to the service-visit credits, newest first, which the app lists among the payments.",
              }),
            })
            .strict(),
        },
      },
    },
    401: errorResponse("session_required"),
  },
});

const entryRoute = createRoute({
  method: "get",
  path: "/api/payments/{id}",
  summary: "One of the client's entries: a payment with its documents, or a refund",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The entry",
      content: {
        "application/json": { schema: z.discriminatedUnion("kind", [PaymentDetailSchema, RefundDetailSchema]) },
      },
    },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such payment or refund of this client's"),
  },
});

const receiptRoute = createRoute({
  method: "get",
  path: "/api/payments/{id}/receipt",
  summary: "A payment's receipt, as a PDF from Books",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The PDF", content: { "application/pdf": { schema: z.string() } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such payment of this client's"),
    409: errorResponse('not_ready: the payment is not in Books yet; the app shows "Document unavailable"'),
  },
});

const documentRoute = createRoute({
  method: "get",
  path: "/api/documents/{id}",
  summary: "A visit's invoice, as a PDF from Books",
  request: { params: z.object({ id: z.uuid().openapi({ description: "The visit's ID." }) }) },
  responses: {
    200: { description: "The PDF", content: { "application/pdf": { schema: z.string() } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such visit of this client's"),
    409: errorResponse('not_ready: Books has not raised the invoice yet; the app shows "Document unavailable"'),
  },
});

export function registerClientPayments(app: App): void {
  for (const path of ["/api/payments", "/api/payments/*", "/api/documents/*"]) {
    app.use(path, requireClientSession);
  }

  app.openapi(paymentsRoute, async (c) => {
    const session = clientOf(c);
    const [entries, credits] = await Promise.all([
      paymentEntries(c.env.DB, session.subjectId),
      creditLines(c.env.DB, session.subjectId),
    ]);
    return c.json({ entries, credits }, 200);
  });

  app.openapi(entryRoute, async (c) => {
    const session = clientOf(c);
    const entry = await paymentEntry(c.env.DB, session.subjectId, c.req.valid("param").id);
    if (entry === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(entry, 200);
  });

  app.openapi(receiptRoute, async (c) => {
    const session = clientOf(c);
    const payment = await receiptOf(c.env.DB, session.subjectId, c.req.valid("param").id);
    if (payment === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const pdf = payment.books_payment_id === null ? null : await c.var.deps.books.receiptPdf(payment.books_payment_id);
    if (pdf === null) return c.json(errorBody("not_ready", c.var.requestId), 409);
    return pdfResponse(pdf.body, "receipt.pdf");
  });

  app.openapi(documentRoute, async (c) => {
    const session = clientOf(c);
    // A draft invoice answers "not ready", as it did before it was raised (ADR 0056).
    const visit = await issuedInvoiceOf(c.env.DB, session.subjectId, c.req.valid("param").id);
    if (visit === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const pdf = visit.invoiceId === null ? null : await c.var.deps.books.invoicePdf(visit.invoiceId);
    if (pdf === null) return c.json(errorBody("not_ready", c.var.requestId), 409);
    return pdfResponse(pdf.body, "invoice.pdf");
  });
}

const pdfResponse = (body: ReadableStream<Uint8Array>, filename: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
