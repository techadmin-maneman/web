// Custom orders, on the client's page in the console (docs/decisions/0174-custom-orders.md):
//   GET  /api/clients/{id}/custom-orders       the client's custom orders, and the suppliers one may be raised with
//   POST /api/clients/{id}/custom-orders       a custom order raised to their profile, and its payment link sent
//   POST /api/custom-orders/{id}/send-link     the link sent again, where it could not be made
//   POST /api/custom-orders/{id}/cancel        an order not yet paid, cancelled, and its link with it
//
// Within the reader's places, as the client's page is: reading with Customer care VIEW, the rest with ACT. Each write
// answers the client's whole list.

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  cancelCustomOrder,
  customOrder,
  customOrdersOf,
  raiseCustomOrder,
  type CustomOrder,
} from "../../domain/field/custom-orders.ts";
import { sendCustomOrderLink } from "../../domain/money/custom-order-links.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { clientInReach } from "../../http/staff-access.ts";
import { WAVES } from "../../policy/hair-profile.ts";
import { MAX_NOTE } from "../../config/consumables.ts";
import { actorOf } from "../../http/audit.ts";

const Note = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NOTE)
  .regex(/^[^\p{Cc}]+$/u);

const written = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

const OrderSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  product: z.string(),
  base_width_in: z.number(),
  base_length_in: z.number(),
  colour: z.string(),
  grey_percent: z.number().int(),
  density_percent: z.number().int(),
  wave: z.string().nullable(),
  note: z.string().nullable(),
  supplier_id: z.string(),
  supplier_price: z.number().int(),
  currency: z.string(),
  amount: z.number().int().openapi({ description: "What the client pays, in paise." }),
  promised_on: z.string().nullable(),
  status: z.enum(["awaiting_payment", "paid", "ordered", "arrived", "cancelled"]),
  short_url: z.string().nullable(),
  link_sent_at: z.string().nullable(),
  paid_at: z.string().nullable(),
  po_number: z.number().int().nullable(),
  raised_at: z.string(),
});

const ORDERS = {
  description: "The client's custom orders, and the suppliers one may be raised with",
  ...json(
    z
      .object({
        orders: z.array(OrderSchema),
        suppliers: z.array(z.object({ id: z.string(), name: z.string(), currency: z.string() })),
      })
      .openapi("ClientCustomOrders"),
  ),
};
const clientPath = { params: z.object({ id: z.uuid() }) };
const orderPath = { params: z.object({ id: z.string().min(1).max(64) }) };
const ACCESS = errorResponse("access_required");
const MISSING = errorResponse("not_found: no such client, or custom order, within the reader's places");

const listRoute = createRoute({
  method: "get",
  path: "/api/clients/{id}/custom-orders",
  summary: "The client's custom orders, and the suppliers one may be raised with",
  request: clientPath,
  responses: { 200: ORDERS, 403: ACCESS, 404: MISSING },
});

const raiseRoute = createRoute({
  method: "post",
  path: "/api/clients/{id}/custom-orders",
  summary: "A custom order raised to the client's profile, and its payment link sent",
  request: {
    ...clientPath,
    body: {
      required: true,
      ...json(
        z
          .object({
            supplier_id: z.string().min(1).max(64),
            supplier_price: z.number().int().min(0).max(100_000_000).openapi({
              description: "One piece from the supplier, in its currency's smallest unit.",
            }),
            amount: z
              .number()
              .int()
              .min(100)
              .max(100_000_000)
              .openapi({ description: "What the client pays, in paise." }),
            promised_on: z.iso.date().nullable(),
            wave: z.enum(WAVES).nullable(),
            note: Note.nullable(),
          })
          .strict()
          .openapi("CustomOrderRaise"),
      ),
    },
  },
  responses: {
    200: ORDERS,
    400: errorResponse(
      "invalid_request: fields names profile for a hair profile missing part of the spec, or supplier_id for no active supplier",
    ),
    403: ACCESS,
    404: MISSING,
  },
});

const stepRoute = (step: "send-link" | "cancel", summary: string) =>
  createRoute({
    method: "post",
    path: `/api/custom-orders/{id}/${step}`,
    summary,
    request: orderPath,
    responses: {
      200: ORDERS,
      403: ACCESS,
      404: MISSING,
      409: errorResponse("order_state: the order is paid or cancelled"),
    },
  });

const orderOut = (order: CustomOrder) => ({
  id: order.id,
  number: order.number,
  product: order.product,
  base_width_in: order.baseWidthIn,
  base_length_in: order.baseLengthIn,
  colour: order.colour,
  grey_percent: order.greyPercent,
  density_percent: order.densityPercent,
  wave: order.wave,
  note: order.note,
  supplier_id: order.supplierId,
  supplier_price: order.supplierPrice,
  currency: order.currency,
  amount: order.amount,
  promised_on: order.promisedOn,
  status: order.status,
  short_url: order.shortUrl,
  link_sent_at: order.linkSentAt,
  paid_at: order.paidAt,
  po_number: order.poNumber,
  raised_at: order.raisedAt,
});

/** What sending a payment link needs, from the request. */
const linkDepsOf = (c: Context<AppEnv>) => ({
  ...c.var.deps,
  log: c.var.log,
  messagingSettings: c.var.config.settings.messaging,
});

async function ordersAnswer(c: Context<AppEnv>, personId: string) {
  const [orders, suppliers] = await Promise.all([
    customOrdersOf(c.env.DB, personId),
    c.env.DB.prepare(
      "SELECT id, name, currency FROM suppliers WHERE retired_at IS NULL ORDER BY name COLLATE NOCASE",
    ).all<{ id: string; name: string; currency: string }>(),
  ]);
  return { orders: orders.map(orderOut), suppliers: suppliers.results };
}

/** The order named, where its client is within the reader's places. */
async function reachedOrder(c: Context<AppEnv>, id: string): Promise<CustomOrder | null> {
  const order = await customOrder(c.env.DB, id);
  if (order === null || (await clientInReach(c, order.personId)) === null) return null;
  return order;
}

export function registerOpsCustomOrders(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    return c.json(await ordersAnswer(c, id), 200);
  });

  app.openapi(raiseRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await clientInReach(c, id)) === null) return refuse(c, "not_found");
    const body = c.req.valid("json");
    const raised = await raiseCustomOrder(
      c.env.DB,
      {
        personId: id,
        supplierId: body.supplier_id,
        supplierPrice: body.supplier_price,
        amount: body.amount,
        promisedOn: body.promised_on,
        wave: body.wave,
        note: body.note,
      },
      written(c),
    );
    if (!raised.ok) return refuse(c, "invalid_request", raised.fields);
    await sendCustomOrderLink(c.env.DB, linkDepsOf(c), raised.id, c.var.deps.now());
    return c.json(await ordersAnswer(c, id), 200);
  });

  app.openapi(
    stepRoute("send-link", "A custom order's payment link sent again, where it could not be made"),
    async (c) => {
      const order = await reachedOrder(c, c.req.valid("param").id);
      if (order === null) return refuse(c, "not_found");
      if (order.status !== "awaiting_payment") return refuse(c, "order_state");
      await sendCustomOrderLink(c.env.DB, linkDepsOf(c), order.id, c.var.deps.now());
      return c.json(await ordersAnswer(c, order.personId), 200);
    },
  );

  app.openapi(stepRoute("cancel", "A custom order not yet paid, cancelled, and its link with it"), async (c) => {
    const order = await reachedOrder(c, c.req.valid("param").id);
    if (order === null) return refuse(c, "not_found");
    if (!(await cancelCustomOrder(c.env.DB, order.id, written(c)))) return refuse(c, "order_state");
    const linkId = await c.env.DB.prepare("SELECT razorpay_link_id FROM custom_orders WHERE id = ?1")
      .bind(order.id)
      .first<string | null>("razorpay_link_id");
    if (linkId !== null) {
      try {
        await c.var.deps.payments.cancelPaymentLink(linkId);
      } catch (error) {
        c.var.log.warn("custom_order_link_not_cancelled", { custom_order_id: order.id, error });
      }
    }
    return c.json(await ordersAnswer(c, order.personId), 200);
  });
}
