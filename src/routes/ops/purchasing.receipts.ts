// Receipts against purchase orders, behind Access (docs/decisions/0167-receipts-and-landed-cost.md):
//   POST /api/purchase-orders/{id}/receipts    what arrived of each line at the warehouse, its lot, what was damaged or
//                                              failed its check, and the receipt's freight, duty and clearing
//   POST /api/purchase-orders/{id}/close       an order part received closed short
//
// Receiving with Operations ACT, closing with MANAGE. Each answers the whole of GET /api/purchase-orders.

import { createRoute, z } from "@hono/zod-openapi";
import { closeOrder } from "../../domain/field/purchase-orders.ts";
import { receiveOrder } from "../../domain/field/receipts.ts";
import { MAX_LABELLED } from "../../domain/field/stock-units.ts";
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
    rupee_rate: z.number().int().min(1).max(10_000_000).nullable().openapi({
      description: "Paise to one unit of the order's currency, as Rs. 83.25 to the dollar is 8325; null for rupees.",
    }),
    freight_paise: Paise,
    duty_paise: Paise,
    clearing_paise: Paise,
    note: Note.nullable(),
  })
  .strict()
  .openapi("PurchaseOrderReceipt");

const receiptRoute = createRoute({
  method: "post",
  path: "/api/purchase-orders/{id}/receipts",
  summary: "What arrived of an order at the warehouse, with its lots and landed cost",
  request: { ...orderPath, body: { required: true, ...json(ReceiptSchema) } },
  responses: {
    200: ORDERS,
    400: errorResponse(
      `invalid_request: fields names lines.N for a line not of the order or more than ${String(MAX_LABELLED)} pieces of a hair system, lines for nothing received, rupee_rate for none on an order in another currency, or id for no such order`,
    ),
    403: errorResponse("access_required"),
    409: errorResponse("order_state: the order is not sent or part received"),
  },
});

const closeRoute = createRoute({
  method: "post",
  path: "/api/purchase-orders/{id}/close",
  summary: "An order part received closed short",
  request: orderPath,
  responses: {
    200: ORDERS,
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such order"),
    409: errorResponse("order_state: the order is not part received"),
  },
});

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
        rupeeRate: body.rupee_rate,
        extras: { freight: body.freight_paise, duty: body.duty_paise, clearing: body.clearing_paise },
        note: body.note,
      },
      written(c),
    );
    if (!received.ok) {
      return "state" in received ? refuse(c, "order_state") : refuse(c, "invalid_request", received.fields);
    }
    return c.json(await ordersAnswer(c), 200);
  });

  app.openapi(closeRoute, async (c) => after(c, await closeOrder(c.env.DB, c.req.valid("param").id, written(c))));
}
