// The client app's payments and documents (docs/prompts/phase2-backend.md,
// "Read endpoints"), from the payments mirror (docs/decisions/0044-payments-mirror.md)
// and Zoho Books (docs/decisions/0032-fsm-mirror.md).
//
//   GET /api/payments          what the client paid, newest first
//   GET /api/payments/:id      one payment, with its refunds
//   GET /api/documents/:id     a visit's invoice, as a PDF from Books
//
// Amounts are in paise, as Razorpay charged them, GST included.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";

const PaymentSchema = z
  .object({
    id: z.uuid(),
    reference: z.union([z.string(), z.null()]).openapi({ description: "Ours, e.g. MM-2026-0841, once captured." }),
    date: z.iso.date().openapi({ description: "India's calendar date the payment was made." }),
    amount: z.number().int().openapi({ description: "In paise, GST included." }),
    refunded_amount: z.number().int().openapi({ description: "In paise: refunds Razorpay has processed." }),
    status: z.enum(["authorized", "captured", "failed", "refunded", "partially_refunded"]),
    method: z.union([z.string(), z.null()]).openapi({ description: "upi, card, netbanking and so on." }),
    visit: z
      .union([
        z.object({ id: z.uuid(), date: z.iso.date(), type: z.union([z.enum(VISIT_TYPES), z.null()]) }).strict(),
        z.null(),
      ])
      .openapi({ description: "The visit it paid for, when known." }),
  })
  .strict()
  .openapi("Payment");

const PaymentDetailSchema = PaymentSchema.extend({
  refunds: z.array(
    z
      .object({
        amount: z.number().int(),
        status: z.enum(["created", "processed", "failed"]),
        speed: z.union([z.string(), z.null()]).openapi({ description: "normal (5 to 7 working days) or instant." }),
        date: z.iso.date(),
      })
      .strict(),
  ),
  document_id: z
    .union([z.uuid(), z.null()])
    .openapi({ description: "The visit's invoice, for GET /api/documents/{id}, once Books has raised it." }),
}).openapi("PaymentDetail");

const paymentsRoute = createRoute({
  method: "get",
  path: "/api/payments",
  summary: "What the client paid, newest first",
  responses: {
    200: {
      description: "The client's payments",
      content: { "application/json": { schema: z.object({ payments: z.array(PaymentSchema) }).strict() } },
    },
    401: errorResponse("session_required"),
  },
});

const paymentRoute = createRoute({
  method: "get",
  path: "/api/payments/{id}",
  summary: "One of the client's payments, with its refunds",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "The payment", content: { "application/json": { schema: PaymentDetailSchema } } },
    401: errorResponse("session_required"),
    404: errorResponse("not_found: no such payment of this client's"),
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

interface PaymentRow {
  id: string;
  reference: string | null;
  created_at: string;
  amount: number;
  refunded_amount: number;
  status: "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";
  method: string | null;
  appointment_id: string | null;
  window_start: string | null;
  type: (typeof VISIT_TYPES)[number] | null;
  fsm_invoice_id: string | null;
}

const PAYMENT_QUERY = `SELECT p.id, p.reference, p.created_at, p.amount, p.refunded_amount, p.status, p.method,
    a.id AS appointment_id, a.window_start, a.type, a.fsm_invoice_id
  FROM payments p LEFT JOIN appointments a ON a.id = p.appointment_id AND a.deleted_at IS NULL
  WHERE p.person_id = ?1`;

function paymentOf(row: PaymentRow) {
  return {
    id: row.id,
    reference: row.reference,
    date: indiaDate(new Date(row.created_at)),
    amount: row.amount,
    refunded_amount: row.refunded_amount,
    status: row.status,
    method: row.method,
    visit:
      row.appointment_id === null || row.window_start === null
        ? null
        : { id: row.appointment_id, date: indiaDate(new Date(row.window_start)), type: row.type },
  };
}

export function registerClientPayments(app: App): void {
  for (const path of ["/api/payments", "/api/payments/*", "/api/documents/*"]) {
    app.use(path, requireClientSession);
  }

  app.openapi(paymentsRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const { results } = await c.env.DB.prepare(`${PAYMENT_QUERY} ORDER BY p.created_at DESC`)
      .bind(session.subjectId)
      .all<PaymentRow>();
    return c.json({ payments: results.map(paymentOf) }, 200);
  });

  app.openapi(paymentRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const row = await db
      .prepare(`${PAYMENT_QUERY} AND p.id = ?2`)
      .bind(session.subjectId, c.req.valid("param").id)
      .first<PaymentRow>();
    if (row === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const { results } = await db
      .prepare("SELECT amount, status, speed, created_at FROM refunds WHERE payment_id = ?1 ORDER BY created_at")
      .bind(row.id)
      .all<{ amount: number; status: "created" | "processed" | "failed"; speed: string | null; created_at: string }>();
    return c.json(
      {
        ...paymentOf(row),
        refunds: results.map((refund) => ({
          amount: refund.amount,
          status: refund.status,
          speed: refund.speed,
          date: indiaDate(new Date(refund.created_at)),
        })),
        document_id: row.fsm_invoice_id === null ? null : row.appointment_id,
      },
      200,
    );
  });

  app.openapi(documentRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const visit = await c.env.DB.prepare(
      "SELECT fsm_invoice_id FROM appointments WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL",
    )
      .bind(c.req.valid("param").id, session.subjectId)
      .first<{ fsm_invoice_id: string | null }>();
    if (visit === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const pdf = visit.fsm_invoice_id === null ? null : await c.var.deps.books.invoicePdf(visit.fsm_invoice_id);
    if (pdf === null) return c.json(errorBody("not_ready", c.var.requestId), 409);
    return new Response(pdf.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="invoice.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  });
}
