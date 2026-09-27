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
import { exGst, GST_PERCENT } from "../config/gst.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { noShowNotes, type NoShowNote } from "../domain/no-shows.ts";
import { requireClientSession } from "../http/client-session.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";
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
const CREDIT_EVENTS = ["added", "used", "lost", "returned", "expired", "withdrawn", "corrected"] as const;
type CreditEvent = (typeof CREDIT_EVENTS)[number];

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

interface VisitColumns {
  appointment_id: string | null;
  window_start: string | null;
  type: (typeof VISIT_TYPES)[number] | null;
}

/** The GST rate a payment was sold at; null for one no hold priced. */
interface RateColumns {
  gst_percent: number | null;
}

interface PaymentRow extends VisitColumns, RateColumns {
  id: string;
  reference: string | null;
  created_at: string;
  amount: number;
  amount_ex_gst: number | null;
  refunded_amount: number;
  status: "authorized" | "captured" | "refunded" | "partially_refunded";
  method: string | null;
  invoice_issued_at: string | null;
  books_payment_id: string | null;
  kind: "visit" | "late_fee";
  charged_change: "moved" | "replaced" | "cancelled" | null;
  charged_at: string | null;
  charged_visit_start: string | null;
  charged_amount: number | null;
}

interface RefundRow extends VisitColumns, RateColumns {
  id: string;
  payment_id: string;
  created_at: string;
  amount: number;
  status: "created" | "processed" | "failed";
  speed: string | null;
  method: string | null;
}

const VISIT_JOIN = `LEFT JOIN appointments a ON a.id = p.appointment_id AND a.deleted_at IS NULL`;

// The change that kept a payment, if any: a late cancel or move keeps the visit's payment, or its late fee.
const PAYMENT_QUERY = `SELECT p.id, p.reference, p.created_at, p.amount, p.amount_ex_gst, p.gst_percent,
    p.refunded_amount, p.status, p.method,
    p.books_payment_id, p.kind, a.id AS appointment_id, a.window_start, a.type, a.invoice_issued_at,
    c.kind AS charged_change, c.created_at AS charged_at, c.was_start AS charged_visit_start,
    c.kept_amount AS charged_amount
  FROM payments p ${VISIT_JOIN}
  LEFT JOIN visit_changes c ON c.payment_id = p.id AND c.notice = 'late' AND c.kept_amount > 0
  WHERE p.person_id = ?1 AND p.status != 'failed'`;

const REFUND_QUERY = `SELECT r.id, r.payment_id, r.created_at, r.amount, r.status, r.speed, p.method, p.gst_percent,
    a.id AS appointment_id, a.window_start, a.type
  FROM refunds r JOIN payments p ON p.id = r.payment_id ${VISIT_JOIN}
  WHERE p.person_id = ?1`;

/** The visit an entry was for, when we know it. */
const visitRefOf = (row: VisitColumns) =>
  row.appointment_id === null || row.window_start === null
    ? null
    : { id: row.appointment_id, date: indiaDate(new Date(row.window_start)), type: row.type };

function moneyOf(
  row: VisitColumns & RateColumns & { created_at: string; amount: number; amount_ex_gst?: number | null },
) {
  const rate = row.gst_percent ?? GST_PERCENT;
  return {
    date: indiaDate(new Date(row.created_at)),
    amount: row.amount,
    amount_ex_gst: row.amount_ex_gst ?? exGst(row.amount, rate),
    gst_percent: rate,
    visit: visitRefOf(row),
  };
}

const paymentOf = (row: PaymentRow, noShows: ReadonlyMap<string, NoShowNote>) => ({
  kind: "payment" as const,
  id: row.id,
  ...moneyOf(row),
  status: row.status,
  method: row.method,
  reference: row.reference,
  refunded_amount: row.refunded_amount,
  purpose: row.kind,
  charge:
    row.charged_change === null || row.charged_at === null || row.charged_visit_start === null
      ? null
      : {
          change: row.charged_change === "cancelled" ? ("cancelled" as const) : ("moved" as const),
          at: row.charged_at,
          visit_started_at: row.charged_visit_start,
          amount: row.charged_amount ?? 0,
        },
  no_show: row.kind === "visit" && row.appointment_id !== null ? (noShows.get(row.appointment_id) ?? null) : null,
});

const refundOf = (row: RefundRow) => ({
  kind: "refund" as const,
  id: row.id,
  payment_id: row.payment_id,
  ...moneyOf(row),
  status: row.status,
  destination: row.method,
  speed: row.speed,
});

/** The no-show notes of the visits these payments paid for. */
const noShowsOf = (db: D1Database, rows: readonly PaymentRow[]) =>
  noShowNotes(
    db,
    rows.flatMap((row) => (row.appointment_id === null ? [] : [row.appointment_id])),
  );

/** A person's payments and refunds as one list, newest first. Ops read the same list on the client's page. */
export async function paymentEntries(db: D1Database, personId: string): Promise<z.infer<typeof EntrySchema>[]> {
  const [payments, refunds] = await Promise.all([
    db.prepare(PAYMENT_QUERY).bind(personId).all<PaymentRow>(),
    db.prepare(REFUND_QUERY).bind(personId).all<RefundRow>(),
  ]);
  const noShows = await noShowsOf(db, payments.results);
  return [
    ...payments.results.map((row) => ({ at: row.created_at, entry: paymentOf(row, noShows) })),
    ...refunds.results.map((row) => ({ at: row.created_at, entry: refundOf(row) })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ entry }) => entry);
}

interface CreditRow extends VisitColumns {
  id: string;
  kind: "grant" | "redeem" | "restore" | "expire" | "clawback" | "adjust";
  visits: number;
  source_kind: "referral" | "appointment" | "ops" | "import";
  created_at: string;
  cancelled_late: number;
}

/**
 * The ledger's entries for the person, newest first, with the visit each was for. An entry that changed nothing,
 * a spent grant closed at its expiry, is left out. A cancel inside 24 hours is read from the visit's own change.
 */
const CREDIT_QUERY = `SELECT l.id, l.kind, l.visits, l.source_kind, l.created_at,
    a.id AS appointment_id, a.window_start, a.type,
    EXISTS (SELECT 1 FROM visit_changes c
      WHERE c.appointment_id = l.source_id AND c.kind = 'cancelled' AND c.notice = 'late') AS cancelled_late
  FROM credit_ledger l
  LEFT JOIN appointments a ON l.source_kind = 'appointment' AND a.id = l.source_id AND a.deleted_at IS NULL
  WHERE l.person_id = ?1 AND l.visits <> 0
  ORDER BY l.created_at DESC, l.rowid DESC`;

/** What a ledger entry was, as the client reads it: a credit spent on a visit it did not buy is lost. */
function creditEventOf(row: CreditRow, noShow: NoShowNote | null): CreditEvent {
  if (row.kind === "grant") return "added";
  if (row.kind === "restore") return "returned";
  if (row.kind === "expire") return "expired";
  if (row.kind === "clawback") return "withdrawn";
  if (row.kind === "adjust") return "corrected";
  const lost = row.cancelled_late === 1 || noShow?.decision === "charged";
  return lost ? "lost" : "used";
}

/** Every change to the person's credits, newest first (LIFE-14): the app lists them among the payments. */
async function creditLines(db: D1Database, personId: string): Promise<z.infer<typeof CreditLineSchema>[]> {
  const { results } = await db.prepare(CREDIT_QUERY).bind(personId).all<CreditRow>();
  const noShows = await noShowNotes(
    db,
    results.flatMap((row) => (row.appointment_id === null ? [] : [row.appointment_id])),
  );
  return results.map((row) => {
    const noShow = row.appointment_id === null ? null : (noShows.get(row.appointment_id) ?? null);
    return {
      id: row.id,
      date: indiaDate(new Date(row.created_at)),
      event: creditEventOf(row, noShow),
      visits: row.visits,
      visit: visitRefOf(row),
      source: row.kind === "grant" && row.source_kind !== "appointment" ? row.source_kind : null,
      no_show: noShow,
    };
  });
}

export function registerClientPayments(app: App): void {
  for (const path of ["/api/payments", "/api/payments/*", "/api/documents/*"]) {
    app.use(path, requireClientSession);
  }

  app.openapi(paymentsRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const [entries, credits] = await Promise.all([
      paymentEntries(c.env.DB, session.subjectId),
      creditLines(c.env.DB, session.subjectId),
    ]);
    return c.json({ entries, credits }, 200);
  });

  app.openapi(entryRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const db = c.env.DB;
    const id = c.req.valid("param").id;
    const payment = await db.prepare(`${PAYMENT_QUERY} AND p.id = ?2`).bind(session.subjectId, id).first<PaymentRow>();
    if (payment !== null) {
      const invoice = payment.invoice_issued_at === null ? null : payment.appointment_id;
      const receipt = payment.books_payment_id === null ? null : payment.id;
      const noShows = await noShowsOf(db, [payment]);
      return c.json({ ...paymentOf(payment, noShows), documents: { invoice, receipt } }, 200);
    }
    const refund = await db.prepare(`${REFUND_QUERY} AND r.id = ?2`).bind(session.subjectId, id).first<RefundRow>();
    if (refund === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json({ ...refundOf(refund), voucher: null }, 200);
  });

  app.openapi(receiptRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    const payment = await c.env.DB.prepare(
      "SELECT books_payment_id FROM payments WHERE id = ?1 AND person_id = ?2 AND status != 'failed'",
    )
      .bind(c.req.valid("param").id, session.subjectId)
      .first<{ books_payment_id: string | null }>();
    if (payment === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const pdf = payment.books_payment_id === null ? null : await c.var.deps.books.receiptPdf(payment.books_payment_id);
    if (pdf === null) return c.json(errorBody("not_ready", c.var.requestId), 409);
    return pdfResponse(pdf.body, "receipt.pdf");
  });

  app.openapi(documentRoute, async (c) => {
    const session = c.var.clientSession;
    if (session === undefined) return c.json(errorBody("session_required", c.var.requestId), 401);
    // A raised invoice is still a draft until the pass marks it sent, and a draft is not a document
    // the client may open (ADR 0056): until then this answers "not ready", as it did before it was raised.
    const visit = await c.env.DB.prepare(
      `SELECT fsm_invoice_id, invoice_issued_at FROM appointments
       WHERE id = ?1 AND person_id = ?2 AND deleted_at IS NULL`,
    )
      .bind(c.req.valid("param").id, session.subjectId)
      .first<{ fsm_invoice_id: string | null; invoice_issued_at: string | null }>();
    if (visit === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    const issued = visit.invoice_issued_at === null ? null : visit.fsm_invoice_id;
    const pdf = issued === null ? null : await c.var.deps.books.invoicePdf(issued);
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
