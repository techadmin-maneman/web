// Receipts against purchase orders, behind Access (docs/decisions/0167-receipts-and-landed-cost.md).
//
// Receiving with Operations ACT, closing with MANAGE. Each answers the whole of GET /api/purchase-orders.

import { MICRO_PER_PAISA } from "../../config/currencies.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { closeOrder } from "../../domain/purchasing/purchase-orders.ts";
import { receiveOrder } from "../../domain/purchasing/receipts.ts";
import { MAX_LABELLED } from "../../domain/inventory/stock-units.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { after, Note, orderPath, ORDERS, ordersAnswer, written } from "./purchasing.ts";

const Count = z.number().int().min(0).max(1_000_000);
const Paise = z.number().int().min(0).max(10_000_000_000);

const ReceiptSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            po_line_id: z.string().min(1).max(64),
            received: Count.openapi({ description: "Accepted into stock; a hair system's at most MAX_LABELLED." }),
            damaged: Count,
            qc_failed: Count,
            lot_code: z.string().trim().min(1).max(40).nullable(),
            expires_on: z.iso.date().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    supplier_invoice: z.string().trim().min(1).max(60).nullable(),
    rate_micro_rupees: z
      .number()
      .int()
      .min(1)
      .max(1_000_000_000_000)
      .nullable()
      .optional()
      .openapi({
        description:
          "Micro-rupees to one whole unit of the order's currency, as Rs. 83.25 to the dollar is 83,250,000 and Rs. " +
          "0.56 to the yen 560,000; null for rupees.",
      }),
    rupee_rate: z.number().int().min(1).max(10_000_000).nullable().optional().openapi({
      description: "Deprecated: send rate_micro_rupees. Paise to one unit of the order's currency.",
    }),
    freight_paise: Paise,
    duty_paise: Paise,
    clearing_paise: Paise,
    note: Note.nullable(),
  })
  .strict()
  .openapi("PurchaseOrderReceipt");

const receiptRoute = opsRoute({
  method: "post",
  path: "/api/purchase-orders/{id}/receipts",
  summary: "What arrived of an order at the warehouse, with its lots and landed cost",
  request: { ...orderPath, body: { required: true, ...json(ReceiptSchema) } },
  responses: {
    200: ORDERS,
    400: errorResponse(
      `invalid_request: fields names lines.N for a line not of the order or more than ${String(MAX_LABELLED)} pieces of a hair system, lines for nothing received, or rate_micro_rupees for none on an order in another currency`,
    ),
    404: errorResponse("not_found: no such order"),
    409: errorResponse("order_state: the order is not sent or part received"),
  },
});

const closeRoute = opsRoute({
  method: "post",
  path: "/api/purchase-orders/{id}/close",
  summary: "An order part received closed short",
  request: orderPath,
  responses: {
    200: ORDERS,
    404: errorResponse("not_found: no such order"),
    409: errorResponse("order_state: the order is not part received"),
  },
});

/** The rate sent, in micro-rupees: the console's own, or a console built before it sending whole paise. */
const rateOf = (body: { rate_micro_rupees?: number | null; rupee_rate?: number | null }): number | null => {
  if (body.rate_micro_rupees !== undefined && body.rate_micro_rupees !== null) return body.rate_micro_rupees;
  return body.rupee_rate === undefined || body.rupee_rate === null ? null : body.rupee_rate * MICRO_PER_PAISA;
};

export function registerOpsReceipts(app: App): void {
  app.openapi(receiptRoute, async (c) => {
    const body = c.req.valid("json");
    const received = await receiveOrder(
      c.env.DB,
      {
        poId: c.req.valid("param").id,
        lines: body.lines.map((line) => ({
          poLineId: line.po_line_id,
          received: line.received,
          damaged: line.damaged,
          qcFailed: line.qc_failed,
          lotCode: line.lot_code,
          expiresOn: line.expires_on,
        })),
        supplierInvoice: body.supplier_invoice,
        rateMicro: rateOf(body),
        extras: { freight: body.freight_paise, duty: body.duty_paise, clearing: body.clearing_paise },
        note: body.note,
      },
      written(c),
    );
    if (!received.ok) return refuse(c, received.code, received.fields);
    return c.json(await ordersAnswer(c), 200);
  });

  app.openapi(closeRoute, async (c) => after(c, await closeOrder(c.env.DB, c.req.valid("param").id, written(c))));
}
