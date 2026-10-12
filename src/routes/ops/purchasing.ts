// Purchase orders, behind Access (docs/decisions/0166-purchase-orders.md):
//   GET  /api/purchase-orders                  open orders and the latest settled, the suppliers to order from
//   POST /api/purchase-orders                  a new order, drafted from a supplier's list
//   POST /api/purchase-orders/{id}/approve     an approval: the first, or a second by another manager
//   POST /api/purchase-orders/{id}/send        an approved order marked sent
//   POST /api/purchase-orders/{id}/cancel      an order cancelled, with why, before anything arrived
//
// Operations' to keep: drafting and sending with ACT, approving and cancelling with MANAGE. Every write answers the
// whole of GET's answer, so the screen follows without reading again.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { MAX_NOTE } from "../../config/consumables.ts";
import { approveOrder, cancelOrder, draftOrder, markSent, purchaseOrders } from "../../domain/field/purchase-orders.ts";
import { allSuppliers } from "../../domain/field/suppliers.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { needsSecondApproval, PO_STATES } from "../../policy/purchasing.ts";

const Text = z.string();
const MaybeText = z.union([z.string(), z.null()]);

const OrdersSchema = z
  .object({
    orders: z.array(
      z
        .object({
          id: Text,
          number: z.number().int().openapi({ description: "Shown as PO-0001." }),
          supplier_id: Text,
          currency: Text,
          state: z.enum(PO_STATES),
          expected_on: z.union([z.iso.date(), z.null()]),
          note: MaybeText,
          total: z.number().int().openapi({ description: "In the order's currency, its smallest unit." }),
          lines: z.array(
            z
              .object({
                id: Text,
                consumable_code: Text,
                quantity: z.number().int(),
                unit_price: z.number().int(),
                received: z.number().int(),
              })
              .strict(),
          ),
          drafted_by: Text,
          drafted_at: z.iso.datetime(),
          approved_by: MaybeText,
          second_approved_by: MaybeText,
          sent_at: z.union([z.iso.datetime(), z.null()]),
          cancel_reason: MaybeText,
          needs_second_approval: z.boolean(),
        })
        .strict(),
    ),
    suppliers: z
      .array(
        z
          .object({
            id: Text,
            name: Text,
            currency: Text,
            items: z.array(
              z
                .object({
                  consumable_code: Text,
                  unit_price: z.number().int(),
                  pack_size: z.number().int(),
                  minimum_order: z.number().int(),
                  lead_time_days: z.number().int(),
                })
                .strict(),
            ),
          })
          .strict(),
      )
      .openapi({
        description:
          "Every supplier, retired ones too, so an order names its supplier; only active ones are drafted to.",
      }),
    consumables: z.array(z.object({ code: Text, name: Text, unit: Text }).strict()),
    second_approval_above_rupees: z.number().int(),
  })
  .strict()
  .openapi("PurchaseOrders");

const ORDERS = { description: "The purchase orders", ...json(OrdersSchema) };
const orderPath = { params: z.object({ id: z.string().min(1).max(64) }) };
const ACCESS = errorResponse("access_required");
const MISSING = errorResponse("not_found: no such order");
const STATE = errorResponse("order_state: the order is past the step asked, or the approver approved it already");

const listRoute = createRoute({
  method: "get",
  path: "/api/purchase-orders",
  summary: "Open orders and the latest settled, with the suppliers to order from",
  responses: { 200: ORDERS, 403: ACCESS },
});

const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const draftRoute = createRoute({
  method: "post",
  path: "/api/purchase-orders",
  summary: "A new order, drafted from a supplier's list at its prices",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            supplier_id: z.string().min(1).max(64),
            lines: z
              .array(
                z
                  .object({
                    consumable_code: z.string().min(1).max(64),
                    quantity: z.number().int().min(1).max(1_000_000),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
            expected_on: z.iso.date().nullable(),
            note: Note.nullable(),
          })
          .strict()
          .openapi("PurchaseOrderDraft"),
      ),
    },
  },
  responses: {
    200: ORDERS,
    400: errorResponse(
      "invalid_request: fields names supplier_id for no active supplier, lines.N for a stock code it does not list or fewer than its minimum, or lines for one named twice",
    ),
    403: ACCESS,
  },
});

const STEP_ANSWERS = { 200: ORDERS, 403: ACCESS, 404: MISSING, 409: STATE };

const stepRoute = (step: "approve" | "send", summary: string) =>
  createRoute({
    method: "post",
    path: `/api/purchase-orders/{id}/${step}`,
    summary,
    request: orderPath,
    responses: STEP_ANSWERS,
  });

const cancelRoute = createRoute({
  method: "post",
  path: "/api/purchase-orders/{id}/cancel",
  summary: "An order cancelled, with why, before anything of it arrived",
  request: {
    ...orderPath,
    body: { required: true, ...json(z.object({ reason: Note }).strict().openapi("PurchaseOrderCancel")) },
  },
  responses: STEP_ANSWERS,
});

async function ordersAnswer(c: Context<AppEnv>) {
  const [orders, suppliers, consumables, inputs] = await Promise.all([
    purchaseOrders(c.env.DB),
    allSuppliers(c.env.DB),
    c.env.DB.prepare("SELECT code, name, unit FROM consumables ORDER BY name COLLATE NOCASE").all<{
      code: string;
      name: string;
      unit: string;
    }>(),
    opsInputs(c),
  ]);
  const above = inputs.poSecondApprovalAboveRupees;
  return {
    orders: orders.map((order) => ({
      id: order.id,
      number: order.number,
      supplier_id: order.supplierId,
      currency: order.currency,
      state: order.state,
      expected_on: order.expectedOn,
      note: order.note,
      total: order.total,
      lines: order.lines.map((line) => ({
        id: line.id,
        consumable_code: line.code,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        received: line.received,
      })),
      drafted_by: order.draftedBy,
      drafted_at: order.draftedAt,
      approved_by: order.approvedBy,
      second_approved_by: order.secondApprovedBy,
      sent_at: order.sentAt,
      cancel_reason: order.cancelReason,
      needs_second_approval: needsSecondApproval(order, above),
    })),
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      currency: supplier.currency,
      items:
        supplier.retiredAt === null
          ? supplier.items.map((item) => ({
              consumable_code: item.code,
              unit_price: item.unitPrice,
              pack_size: item.packSize,
              minimum_order: item.minimumOrder,
              lead_time_days: item.leadTimeDays,
            }))
          : [],
    })),
    consumables: consumables.results,
    second_approval_above_rupees: above,
  };
}

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

async function after(c: Context<AppEnv>, changed: Awaited<ReturnType<typeof markSent>>) {
  if (!changed.ok) return "missing" in changed ? refuse(c, "not_found") : refuse(c, "order_state");
  return c.json(await ordersAnswer(c), 200);
}

export function registerOpsPurchasing(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await ordersAnswer(c), 200));

  app.openapi(draftRoute, async (c) => {
    const body = c.req.valid("json");
    const draft = {
      supplierId: body.supplier_id,
      lines: body.lines.map((line) => ({ code: line.consumable_code, quantity: line.quantity })),
      expectedOn: body.expected_on,
      note: body.note,
    };
    const drafted = await draftOrder(c.env.DB, draft, written(c));
    if (!drafted.ok) return refuse(c, "invalid_request", drafted.fields);
    return c.json(await ordersAnswer(c), 200);
  });

  app.openapi(stepRoute("approve", "An approval: the first, or a second by another manager"), async (c) => {
    const { poSecondApprovalAboveRupees } = await opsInputs(c);
    return after(c, await approveOrder(c.env.DB, c.req.valid("param").id, poSecondApprovalAboveRupees, written(c)));
  });

  app.openapi(stepRoute("send", "An approved order marked sent"), async (c) =>
    after(c, await markSent(c.env.DB, c.req.valid("param").id, written(c))),
  );

  app.openapi(cancelRoute, async (c) =>
    after(c, await cancelOrder(c.env.DB, c.req.valid("param").id, c.req.valid("json").reason, written(c))),
  );
}
