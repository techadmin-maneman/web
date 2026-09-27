// The consumables ops keep, and what each service is expected to use, behind Access
// (docs/decisions/0087-consumables-and-stock.md):
//   GET  /api/consumables                   every consumable, where each stands in FSM, and each service's expected use
//   POST /api/consumables                   add one
//   POST /api/consumables/:code             rename it, or change its unit, its cost or its reorder levels
//   POST /api/consumables/:code/retire      no longer offered, from a day
//   POST /api/consumables/:code/restore     offered again
//   POST /api/service-usage                 what one service is expected to use, the whole list at once
//
// A change here needs no release. Each records the Access identity behind it,
// with what it changed, in the same batch as the change (ADR 0031). Every
// write answers the whole of GET's answer, so the screen follows it without
// reading again. FSM's catalogue follows at the hourly check, as parts at
// Rs. 0, only while the owner has FSM_CATALOGUE_PUSH on (src/domain/fsm-catalogue.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { CONSUMABLE_BOUNDS, CONSUMABLE_NAME, CONSUMABLE_UNIT } from "../config/consumables.ts";
import { VISIT_TYPES } from "../config/visit-types.ts";
import { PRICE_TIER } from "../config/ops-settings.ts";
import {
  addConsumable,
  allConsumables,
  changeConsumable,
  expectedUse,
  fsmLinkOf,
  isOffered,
  retireConsumable,
  servicesPriced,
  setExpectedUse,
  type Consumable,
} from "../domain/consumables.ts";
import { staffOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { indiaDate } from "../lib/india-time.ts";

const Name = z.string().trim().regex(CONSUMABLE_NAME).openapi({
  description: "A letter or a digit first, then letters, digits, spaces and . , ' ( ) & / + % -; at most 60.",
});
const Unit = z
  .string()
  .trim()
  .regex(CONSUMABLE_UNIT)
  .openapi({ description: "strip, ml, sachet: at most 20 letters." });
const UnitCost = z.number().int().min(0).max(CONSUMABLE_BOUNDS.maxUnitCost).openapi({ description: "In paise." });
const Level = z.union([z.number().int().min(0).max(CONSUMABLE_BOUNDS.maxReorderLevel), z.null()]);

const ConsumableSchema = z
  .object({
    code: z.string(),
    name: z.string(),
    unit: z.string(),
    unit_cost: z.number().int().openapi({ description: "In paise, for one unit. Ours alone: no invoice carries it." }),
    reorder_kit: z.union([z.number().int(), z.null()]).openapi({
      description: "A kit is low at or below this, in the consumable's unit; null for no level.",
    }),
    reorder_central: z.union([z.number().int(), z.null()]).openapi({
      description: "The central store is low at or below this; null for no level.",
    }),
    retired_from: z.union([z.iso.date(), z.null()]).openapi({
      description: "The day in India it is no longer offered from; null while it is.",
    }),
    offered: z.boolean().openapi({ description: "Whether the technician app offers it today." }),
    fsm: z
      .object({
        state: z.enum(["linked", "renamed", "missing", "unchecked"]).openapi({
          description:
            "A part by this name; a part still under another name; no part by this name; or not read yet. " +
            "The hourly check reads FSM's catalogue.",
        }),
        item_id: z.union([z.string(), z.null()]),
        name: z.union([z.string(), z.null()]).openapi({ description: "What FSM calls the part." }),
      })
      .strict(),
  })
  .strict()
  .openapi("Consumable");

const ExpectedSchema = z.object({ code: z.string(), quantity: z.number().int() }).strict();

const ServiceUseSchema = z
  .object({
    visit_type: z.enum(VISIT_TYPES),
    tier: z.string(),
    expected: z.array(ExpectedSchema).openapi({ description: "What it is expected to use, by the consumable's name." }),
  })
  .strict()
  .openapi("ServiceUse", { description: "A service the price book prices: a kind of visit at a tier." });

const ConsumablesSchema = z
  .object({
    consumables: z.array(ConsumableSchema).openapi({ description: "Every consumable, retired ones too, by name." }),
    services: z.array(ServiceUseSchema),
    today: z.iso.date(),
    fsm_push: z.boolean().openapi({
      description: "Whether FSM's catalogue follows by itself (FSM_CATALOGUE_PUSH); off, ops set it there by hand.",
    }),
    max_unit_cost: z.number().int(),
    max_expected: z.number().int(),
    max_reorder_level: z.number().int(),
  })
  .strict()
  .openapi("Consumables");

const CONSUMABLES = { description: "Every consumable and each service's expected use", ...json(ConsumablesSchema) };
const REFUSED = errorResponse("invalid_request: fields names what was refused, such as a name already taken");

const consumablesRoute = createRoute({
  method: "get",
  path: "/api/consumables",
  summary: "Every consumable, where each stands in FSM's catalogue, and what each service is expected to use",
  responses: { 200: CONSUMABLES, 403: errorResponse("access_required") },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/consumables",
  summary: "Add a consumable. The technician app offers it from now on",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            name: Name,
            unit: Unit,
            unit_cost: UnitCost,
            reorder_kit: Level.optional(),
            reorder_central: Level.optional(),
          })
          .strict()
          .openapi("NewConsumable"),
      ),
    },
  },
  responses: { 200: CONSUMABLES, 400: REFUSED, 403: errorResponse("access_required") },
});

const code = z.object({ code: z.string().min(1).max(64) });

const changeRoute = createRoute({
  method: "post",
  path: "/api/consumables/{code}",
  summary: "Rename a consumable, or change its unit, its cost or its reorder levels. Only the fields sent change",
  request: {
    params: code,
    body: {
      required: true,
      ...json(
        z
          .object({
            name: Name.optional(),
            unit: Unit.optional(),
            unit_cost: UnitCost.optional(),
            reorder_kit: Level.optional(),
            reorder_central: Level.optional(),
          })
          .strict()
          .openapi("ConsumableChange"),
      ),
    },
  },
  responses: {
    200: CONSUMABLES,
    400: REFUSED,
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such consumable"),
  },
});

const retireRoute = createRoute({
  method: "post",
  path: "/api/consumables/{code}/retire",
  summary: "Stop offering a consumable from a day. Nothing already recorded moves",
  request: {
    params: code,
    body: { required: true, ...json(z.object({ from: z.iso.date() }).strict().openapi("ConsumableRetirement")) },
  },
  responses: {
    200: CONSUMABLES,
    400: errorResponse("invalid_request: fields names from, a day before today"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such consumable"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  path: "/api/consumables/{code}/restore",
  summary: "Offer a retired consumable again",
  request: { params: code },
  responses: {
    200: CONSUMABLES,
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such consumable"),
  },
});

const usageRoute = createRoute({
  method: "post",
  path: "/api/service-usage",
  summary: "What one service is expected to use. The whole list: a consumable left out is expected no more",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            visit_type: z.enum(VISIT_TYPES),
            tier: z.string().regex(PRICE_TIER),
            items: z
              .array(
                z
                  .object({
                    code: z.string().min(1).max(64),
                    quantity: z.number().int().min(1).max(CONSUMABLE_BOUNDS.maxExpected),
                  })
                  .strict(),
              )
              .max(50),
          })
          .strict()
          .openapi("ServiceUsage"),
      ),
    },
  },
  responses: {
    200: CONSUMABLES,
    400: errorResponse(
      "invalid_request: fields names tier for a service the price book does not price, or items.N.code for a " +
        "consumable nobody added or one named twice",
    ),
    403: errorResponse("access_required"),
  },
});

function consumableBody(consumable: Consumable, today: string) {
  return {
    code: consumable.code,
    name: consumable.name,
    unit: consumable.unit,
    unit_cost: consumable.unitCost,
    reorder_kit: consumable.reorderKit,
    reorder_central: consumable.reorderCentral,
    retired_from: consumable.retiredDate,
    offered: isOffered(consumable, today),
    fsm: { state: fsmLinkOf(consumable), item_id: consumable.fsmItemId, name: consumable.fsmName },
  };
}

/** GET's answer, which every write answers too. */
async function answer(c: Context<AppEnv>) {
  const db = c.env.DB;
  const today = indiaDate(c.var.deps.now());
  const [consumables, services, expected] = await Promise.all([
    allConsumables(db),
    servicesPriced(db),
    expectedUse(db),
  ]);
  return {
    consumables: consumables.map((consumable) => consumableBody(consumable, today)),
    services: services.map((service) => ({
      visit_type: service.visitType,
      tier: service.tier,
      expected: expected
        .filter((each) => each.visitType === service.visitType && each.tier === service.tier)
        .map((each) => ({ code: each.code, quantity: each.quantity })),
    })),
    today,
    fsm_push: c.var.config.settings.fsmCataloguePush,
    max_unit_cost: CONSUMABLE_BOUNDS.maxUnitCost,
    max_expected: CONSUMABLE_BOUNDS.maxExpected,
    max_reorder_level: CONSUMABLE_BOUNDS.maxReorderLevel,
  };
}

const written = (c: Context<AppEnv>) => ({ actor: staffOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsConsumables(app: App): void {
  app.openapi(consumablesRoute, async (c) => c.json(await answer(c), 200));

  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const saved = await addConsumable(
      c.env.DB,
      {
        name: body.name,
        unit: body.unit,
        unitCost: body.unit_cost,
        reorderKit: body.reorder_kit ?? null,
        reorderCentral: body.reorder_central ?? null,
      },
      written(c),
    );
    if (!saved.ok) return c.json(errorBody("invalid_request", c.var.requestId, saved.fields), 400);
    return c.json(await answer(c), 200);
  });

  app.openapi(changeRoute, async (c) => {
    const body = c.req.valid("json");
    const saved = await changeConsumable(
      c.env.DB,
      c.req.valid("param").code,
      {
        name: body.name,
        unit: body.unit,
        unitCost: body.unit_cost,
        reorderKit: body.reorder_kit,
        reorderCentral: body.reorder_central,
      },
      written(c),
    );
    if (saved === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (!saved.ok) return c.json(errorBody("invalid_request", c.var.requestId, saved.fields), 400);
    return c.json(await answer(c), 200);
  });

  app.openapi(retireRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    const { from } = c.req.valid("json");
    const saved = await retireConsumable(c.env.DB, c.req.valid("param").code, from, { ...written(c), today });
    if (saved === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    if (!saved.ok) return c.json(errorBody("invalid_request", c.var.requestId, saved.fields), 400);
    return c.json(await answer(c), 200);
  });

  app.openapi(restoreRoute, async (c) => {
    const today = indiaDate(c.var.deps.now());
    const saved = await retireConsumable(c.env.DB, c.req.valid("param").code, null, { ...written(c), today });
    if (saved === null) return c.json(errorBody("not_found", c.var.requestId), 404);
    return c.json(await answer(c), 200);
  });

  app.openapi(usageRoute, async (c) => {
    const body = c.req.valid("json");
    const saved = await setExpectedUse(c.env.DB, {
      service: { visitType: body.visit_type, tier: body.tier },
      items: body.items,
      ...written(c),
    });
    if (!saved.ok) return c.json(errorBody("invalid_request", c.var.requestId, saved.fields), 400);
    return c.json(await answer(c), 200);
  });
}
