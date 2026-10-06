// The price book in the console (./settings.ts): every price with the row in force marked, a price from the day it
// applies, and a price still to come taken back, or taken back and set again.

import { createRoute, z } from "@hono/zod-openapi";
import {
  correctPrice,
  PRICE_ITEMS,
  priceBook,
  priceRefusal,
  setPrice,
  withdrawPrice,
  type PriceRefusal,
} from "../../domain/money/price-book.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { PRICE_BOUNDS } from "../../policy/ops-settings.ts";
import { PRICE_TIER } from "../../policy/services.ts";
import { PriceRowSchema } from "../schemas/prices.ts";

/** A price as ops set one: what it prices, the figures, and the day it applies from. */
const PriceFields = {
  item: z.enum(PRICE_ITEMS).openapi({ description: "A kind of visit, or one of the two late fees." }),
  tier: z.string().regex(PRICE_TIER).openapi({
    description: "For a visit, the code of one of its kind's services; for a late fee, standard.",
  }),
  amount_ex_gst: z.number().int().min(PRICE_BOUNDS.minPaise).max(PRICE_BOUNDS.maxPaise),
  gst_percent: z.number().int().min(PRICE_BOUNDS.minGstPercent).max(PRICE_BOUNDS.maxGstPercent),
  valid_from: z.iso.date(),
};

const bookAnswer = {
  description: "The book as it now stands",
  ...json(z.object({ prices: z.array(PriceRowSchema) }).strict()),
};

/** A refused price as the API answers it: the box it names, and whether its service is retired by then. */
const priceRefused = (requestId: string, refusal: PriceRefusal) =>
  refusal.retired === true
    ? errorBody("service_retired", requestId, [refusal.field])
    : errorBody("invalid_request", requestId, [refusal.field]);

const pricesRoute = createRoute({
  method: "get",
  path: "/api/prices",
  summary: "The price book: every price, past, present and scheduled",
  responses: {
    200: {
      description: "Prices",
      ...json(
        z
          .object({
            prices: z.array(PriceRowSchema),
            today: z.iso.date(),
            max_amount_ex_gst: z.number().int(),
            max_gst_percent: z.number().int(),
          })
          .strict(),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const setPriceRoute = createRoute({
  method: "post",
  path: "/api/prices",
  summary: "A price from the date it applies, tomorrow at the earliest. A change is a new row, so nothing sold moves",
  request: {
    body: { required: true, ...json(z.object(PriceFields).strict().openapi("PriceChange")) },
  },
  responses: {
    200: bookAnswer,
    400: errorResponse(
      "invalid_request: fields names what was refused, valid_from when it is before tomorrow, tier where no service " +
        "of the kind has it; service_retired: the service is retired by the day it would apply from",
    ),
    403: errorResponse("access_required"),
  },
});

const correctPriceRoute = createRoute({
  method: "post",
  path: "/api/prices/correct",
  summary: "Correct a price still to come: take it back and set its replacement, from tomorrow or later, at once",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            ...PriceFields,
            was_valid_from: z.iso.date().openapi({ description: "The day the price still to come applies from." }),
          })
          .strict()
          .openapi("PriceCorrection"),
      ),
    },
  },
  responses: {
    200: bookAnswer,
    400: errorResponse(
      "invalid_request: fields names what was refused, was_valid_from when that row applies today or applied " +
        "before; service_retired: the service is retired by the new day",
    ),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: the book holds no such row to correct"),
  },
});

const withdrawPriceRoute = createRoute({
  method: "post",
  path: "/api/prices/withdraw",
  summary: "Take back a price still to come. The one in force and the spent ones stay: an invoice may stand on them",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ item: z.enum(PRICE_ITEMS), tier: z.string().regex(PRICE_TIER), valid_from: z.iso.date() })
          .strict()
          .openapi("PriceWithdrawal"),
      ),
    },
  },
  responses: {
    200: bookAnswer,
    400: errorResponse("invalid_request: fields names valid_from when the row applies today or applied before"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: the book holds no such row"),
  },
});

export function registerOpsPrices(app: App): void {
  app.openapi(pricesRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    return c.json(
      {
        prices: await priceBook(c.env.DB, today),
        today,
        max_amount_ex_gst: PRICE_BOUNDS.maxPaise,
        max_gst_percent: PRICE_BOUNDS.maxGstPercent,
      },
      200,
    );
  });

  app.openapi(setPriceRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const price = c.req.valid("json");
    const refusal = await priceRefusal(c.env.DB, price, today);
    if (refusal !== null) {
      c.var.log.warn("price_refused", { item: price.item, field: refusal.field });
      return c.json(priceRefused(c.var.requestId, refusal), 400);
    }
    await setPrice(c.env.DB, { price, actor: actorOf(c), requestId: c.var.requestId, now });
    return c.json({ prices: await priceBook(c.env.DB, today) }, 200);
  });

  app.openapi(correctPriceRoute, async (c) => {
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const { was_valid_from: wasValidFrom, ...price } = c.req.valid("json");
    const refusal = await priceRefusal(c.env.DB, price, today);
    if (refusal !== null) {
      c.var.log.warn("price_refused", { item: price.item, field: refusal.field });
      return c.json(priceRefused(c.var.requestId, refusal), 400);
    }
    const was = { item: price.item, tier: price.tier, valid_from: wasValidFrom };
    const result = await correctPrice(c.env.DB, { was, price, actor: actorOf(c), requestId: c.var.requestId, now });
    if (result === "not_found") return refuse(c, "not_found");
    if (result === "not_to_come") {
      c.var.log.warn("price_correction_refused", { item: price.item });
      return refuse(c, "invalid_request", ["was_valid_from"]);
    }
    return c.json({ prices: await priceBook(c.env.DB, today) }, 200);
  });

  app.openapi(withdrawPriceRoute, async (c) => {
    const now = c.var.deps.now();
    const row = c.req.valid("json");
    const result = await withdrawPrice(c.env.DB, { row, actor: actorOf(c), requestId: c.var.requestId, now });
    if (result === "not_found") return refuse(c, "not_found");
    if (result === "not_to_come") {
      c.var.log.warn("price_withdrawal_refused", { item: row.item });
      return refuse(c, "invalid_request", ["valid_from"]);
    }
    return c.json({ prices: await priceBook(c.env.DB, indiaDate(now)) }, 200);
  });
}
