// The business inputs ops set for themselves, behind Access (Ops Console, the
// Settings section the design draws; docs/decisions/0061-ops-editable-inputs.md):
//   GET  /api/settings              every rule ops may change, with its unit and its bounds
//   POST /api/settings/:name        set one, or send null to put the default back
//   GET  /api/prices                the price book, with the row in force marked
//   POST /api/prices                a price from the date it applies
//   GET  /api/service-area          every pincode, its city and whether we go there
//   POST /api/service-area          which pincodes we go to, and from when
//
// A change here needs no release. Every one records the Access identity behind
// it, what the value was and what it is now, in the same batch as the change
// itself (ADR 0031).

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../app.ts";
import { allowed, checkValue, OPS_SETTINGS, settingNamed, PRICE_BOUNDS, PRICE_TIER } from "../config/ops-settings.ts";
import { actorOf } from "../domain/audit.ts";
import { setOpsSetting, settingStates } from "../domain/ops-settings.ts";
import { checkPrice, PRICE_ITEMS, priceBook, setPrice } from "../domain/price-book.ts";
import { serviceArea, setServiceArea } from "../domain/service-area.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { indiaDate } from "../lib/india-time.ts";

const json = <T extends z.ZodType>(schema: T) => ({ content: { "application/json": { schema } } });

/** One number, or one per key: the two shapes a rule's value takes. */
const ValueSchema = z.union([z.number().int(), z.record(z.string(), z.number().int())]);

const SettingSchema = z
  .object({
    name: z.string(),
    title: z.string(),
    note: z.string(),
    unit: z.string(),
    min: z.number().int(),
    max: z.number().int(),
    keys: z
      .union([z.array(z.string()), z.literal("open"), z.null()])
      .openapi({ description: 'null for one number, a list where the keys are fixed, "open" where ops name them.' }),
    value: ValueSchema,
    default: ValueSchema.openapi({ description: "The committed figure, in force until somebody sets one." }),
    source: z.string().openapi({ description: "The module the default lives in." }),
    set_by: z.union([z.string(), z.null()]),
    set_at: z.union([z.iso.datetime(), z.null()]),
  })
  .strict()
  .openapi("OpsSetting");

const settingsRoute = createRoute({
  method: "get",
  path: "/api/settings",
  summary: "Every business rule ops may change, with its unit, its bounds and who last set it",
  responses: {
    200: { description: "The rules", ...json(z.object({ settings: z.array(SettingSchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const setSettingRoute = createRoute({
  method: "post",
  path: "/api/settings/{name}",
  summary: "Set one rule, or send a null value to put the committed default back",
  request: {
    params: z.object({ name: z.enum(OPS_SETTINGS.map((setting) => setting.name) as [string, ...string[]]) }),
    body: {
      required: true,
      ...json(
        z
          .object({ value: z.union([ValueSchema, z.null()]) })
          .strict()
          .openapi("SettingChange"),
      ),
    },
  },
  responses: {
    200: { description: "What it is now", ...json(SettingSchema) },
    400: errorResponse("invalid_request: the figure is outside what the rule allows, and fields names it"),
    403: errorResponse("access_required"),
  },
});

const PriceSchema = z
  .object({
    item: z.enum(PRICE_ITEMS),
    tier: z.string(),
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST." }),
    gst_percent: z.number().int(),
    valid_from: z.iso.date().openapi({ description: "India's date it applies from." }),
    in_force: z.boolean(),
  })
  .strict()
  .openapi("Price");

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
            prices: z.array(PriceSchema),
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
  summary: "A price from the date it applies. A change is a new row, so nothing already invoiced moves",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            item: z.enum(PRICE_ITEMS).openapi({ description: "A kind of visit, or one of the two late fees." }),
            tier: z.string().regex(PRICE_TIER),
            amount_ex_gst: z.number().int().min(PRICE_BOUNDS.minPaise).max(PRICE_BOUNDS.maxPaise),
            gst_percent: z.number().int().min(PRICE_BOUNDS.minGstPercent).max(PRICE_BOUNDS.maxGstPercent),
            valid_from: z.iso.date(),
          })
          .strict()
          .openapi("PriceChange"),
      ),
    },
  },
  responses: {
    200: { description: "The book as it now stands", ...json(z.object({ prices: z.array(PriceSchema) }).strict()) },
    400: errorResponse("invalid_request: fields names what was refused"),
    403: errorResponse("access_required"),
  },
});

const AreaSchema = z
  .object({
    pincode: z.string(),
    area: z.string(),
    city: z.string(),
    served: z.boolean(),
    launch_on: z.union([z.iso.date(), z.null()]),
  })
  .strict()
  .openapi("ServedPincode");

const serviceAreaRoute = createRoute({
  method: "get",
  path: "/api/service-area",
  summary: "Every pincode we hold, its city, and whether a technician goes there",
  responses: {
    200: { description: "Pincodes", ...json(z.object({ pincodes: z.array(AreaSchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const setServiceAreaRoute = createRoute({
  method: "post",
  path: "/api/service-area",
  summary: "Which pincodes we go to, and from when. Only the pincodes named change",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            changes: z
              .array(
                z
                  .object({
                    pincode: z.string().regex(/^[1-8]\d{5}$/),
                    served: z.boolean(),
                    launch_on: z.union([z.iso.date(), z.null()]),
                  })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict()
          .openapi("ServiceAreaChange"),
      ),
    },
  },
  responses: {
    200: {
      description: "What changed",
      ...json(z.object({ changed: z.number().int(), served: z.number().int() }).strict()),
    },
    400: errorResponse(
      "invalid_request: fields names a pincode we do not hold. no_service_area: it would leave none served",
    ),
    403: errorResponse("access_required"),
  },
});

/** The Access identity, which requireAccess has already put in place on this surface. */
function staffOf(c: { var: { accessIdentity?: Parameters<typeof actorOf>[0] } }) {
  const identity = c.var.accessIdentity;
  if (identity === undefined) throw new Error("ops routes run after requireAccess");
  return actorOf(identity);
}

const stateBody = (state: Awaited<ReturnType<typeof settingStates>>[number]) => ({
  name: state.setting.name,
  title: state.setting.title,
  note: state.setting.note,
  unit: state.setting.unit,
  min: state.setting.min,
  max: state.setting.max,
  keys:
    state.setting.keys === "open" ? ("open" as const) : state.setting.keys === null ? null : [...state.setting.keys],
  value: state.value,
  default: state.setting.fallback,
  source: state.setting.source,
  set_by: state.setBy,
  set_at: state.setAt,
});

export function registerOpsSettings(app: App): void {
  app.openapi(settingsRoute, async (c) => {
    const states = await settingStates(c.env.DB);
    return c.json({ settings: states.map(stateBody) }, 200);
  });

  app.openapi(setSettingRoute, async (c) => {
    // The path only takes a name the register holds; zod refuses any other with 400.
    const setting = settingNamed(c.req.valid("param").name);
    if (setting === undefined) throw new Error("the route allowed a name the register does not hold");
    const { value } = c.req.valid("json");

    if (value !== null) {
      const checked = checkValue(setting, value);
      if (!checked.ok) {
        c.var.log.warn("setting_refused", { setting: setting.name, allowed: allowed(setting) });
        return c.json(
          errorBody(
            "invalid_request",
            c.var.requestId,
            checked.refusals.map((refusal) => refusal.field),
          ),
          400,
        );
      }
      await setOpsSetting(c.env.DB, {
        setting,
        value: checked.value,
        actor: staffOf(c),
        requestId: c.var.requestId,
        now: c.var.deps.now(),
      });
    } else {
      await setOpsSetting(c.env.DB, {
        setting,
        value: null,
        actor: staffOf(c),
        requestId: c.var.requestId,
        now: c.var.deps.now(),
      });
    }

    const states = await settingStates(c.env.DB);
    const state = states.find((each) => each.setting.name === setting.name);
    if (state === undefined) throw new Error("the register lost a setting between writing and reading it");
    return c.json(stateBody(state), 200);
  });

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
    const refusal = checkPrice(price, today);
    if (refusal !== null) {
      c.var.log.warn("price_refused", { item: price.item, field: refusal.field });
      return c.json(errorBody("invalid_request", c.var.requestId, [refusal.field]), 400);
    }
    await setPrice(c.env.DB, { price, actor: staffOf(c), requestId: c.var.requestId, now });
    return c.json({ prices: await priceBook(c.env.DB, today) }, 200);
  });

  app.openapi(serviceAreaRoute, async (c) => {
    return c.json({ pincodes: await serviceArea(c.env.DB) }, 200);
  });

  app.openapi(setServiceAreaRoute, async (c) => {
    const result = await setServiceArea(c.env.DB, {
      changes: c.req.valid("json").changes,
      actor: staffOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if ("kind" in result) {
      c.var.log.warn("service_area_refused", { reason: result.kind });
      if (result.kind === "empty_area") return c.json(errorBody("no_service_area", c.var.requestId), 400);
      return c.json(errorBody("invalid_request", c.var.requestId, result.pincodes), 400);
    }
    return c.json({ changed: result.changed.length, served: result.served }, 200);
  });
}
