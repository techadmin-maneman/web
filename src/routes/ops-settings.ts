// The business inputs ops set for themselves, behind Access (Ops Console, the
// Settings section the design draws; docs/decisions/0061-ops-editable-inputs.md):
//   GET  /api/settings              every rule ops may change, with its unit and its bounds
//   POST /api/settings/:name        set one, or send null to put the default back
//   GET  /api/prices                the price book, with the row in force marked
//   POST /api/prices                a price from the date it applies, for a service or a late fee
//   POST /api/prices/withdraw       a price still to come, taken back
//   POST /api/prices/correct        a price still to come, taken back and set again, in one batch
//   GET  /api/service-area          every pincode, its city, whether we go there and who waits there
//   POST /api/service-area          which pincodes we go to, from when, and what their areas are called
//   POST /api/pincodes              a pincode the service area does not hold, added unserved
//
// A change here needs no release. Every one records the Access identity behind
// it, what the value was and what it is now, in the same batch as the change
// itself (ADR 0031). Serving a pincode launches it, as the waitlist's launch
// does (docs/decisions/0071-what-ops-see-before-a-setting-changes.md). A
// visit's price is its service's, so it is set only for a service the console
// holds, and not from the day it is retired by; the services themselves are
// src/routes/ops-services.ts's (docs/decisions/0085-services-ops-can-edit.md).

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../http/audit.ts";
import type { App } from "../http/context.ts";
import {
  boundsOf,
  checkValue,
  isChoice,
  OPS_SETTINGS,
  settingNamed,
  PRICE_BOUNDS,
  type NumberSetting,
} from "../config/ops-settings.ts";
import { setOpsSetting, settingStates } from "../domain/ops-settings.ts";
import {
  correctPrice,
  PRICE_ITEMS,
  priceBook,
  priceRefusal,
  setPrice,
  withdrawPrice,
  type PriceRefusal,
} from "../domain/price-book.ts";
import { listCities } from "../domain/cities.ts";
import { addPincode, serviceArea, setServiceArea } from "../domain/service-area.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { queuePacedMessages } from "../http/queue-message.ts";
import { routeReach } from "../http/staff-access.ts";
import { indiaDate } from "../lib/india-time.ts";
import { reachesCity } from "../policy/access.ts";
import { PRICE_TIER } from "../policy/services.ts";

/** One number, or one per key: the two shapes a rule of numbers takes. */
const NumberValue = z.union([z.number().int(), z.record(z.string(), z.number().int())]);
/** One choice per key: the shape a rule of choices takes. */
const ChoiceValue = z.record(z.string(), z.string());

/** The rules ops may set, by name: the listing names them as the path that sets one does. */
const SettingName = z.enum(OPS_SETTINGS.map((setting) => setting.name) as [string, ...string[]]);

/** What every rule says of itself, whatever its figures are. */
const Described = {
  name: SettingName,
  title: z.string(),
  note: z.string(),
  set_by: z.union([z.string(), z.null()]),
  set_at: z.union([z.iso.datetime(), z.null()]),
};

const NumberRuleSchema = z
  .object({
    ...Described,
    kind: z.literal("number"),
    unit: z.string(),
    min: z.number().int(),
    max: z.number().int(),
    keys: z
      .union([z.array(z.string()), z.literal("open"), z.null()])
      .openapi({ description: 'null for one number, a list where the keys are fixed, "open" where ops name them.' }),
    bounds: z
      .union([
        z.record(z.string(), z.object({ min: z.number().int(), max: z.number().int(), unit: z.string() }).strict()),
        z.null(),
      ])
      .openapi({
        description:
          "Each key's own bounds and unit, where a keyed rule's figures measure different things; null where every " +
          "figure takes min to max, in unit.",
      }),
    value: NumberValue,
    default: NumberValue.openapi({ description: "The committed figure, in force until somebody sets one." }),
  })
  .strict()
  .openapi("NumberRule");

const ChoiceRuleSchema = z
  .object({
    ...Described,
    kind: z.literal("choice"),
    keys: z.array(z.string()),
    choices: z.record(z.string(), z.array(z.string())).openapi({
      description: "What each key may be: a kind of visit with no late fee in the price book is offered none.",
    }),
    value: ChoiceValue,
    default: ChoiceValue.openapi({ description: "The committed choices, in force until somebody sets them." }),
  })
  .strict()
  .openapi("ChoiceRule");

const SettingSchema = z.discriminatedUnion("kind", [NumberRuleSchema, ChoiceRuleSchema]).openapi("OpsSetting");

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
    params: z.object({ name: SettingName }),
    body: {
      required: true,
      ...json(
        z
          .object({ value: z.union([NumberValue, ChoiceValue, z.null()]) })
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

export const PriceRowSchema = z
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

/**
 * An area's name, as a launch message and the waitlist show it: a letter or a
 * digit first, so a spreadsheet opening the exported list never reads it as a
 * formula, then letters, digits, spaces and . , ' ( ) & -.
 */
const AREA_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'()&-]{1,39}$/u;

const AreaSchema = z
  .object({
    pincode: z.string(),
    area: z.string(),
    city: z.string(),
    served: z.boolean(),
    launch_on: z.union([z.iso.date(), z.null()]),
    waiting: z.number().int().openapi({ description: "How many are on its waitlist." }),
    to_alert: z.number().int().openapi({
      description: "How many of them serving it would tell now: those who asked, and have not been told yet.",
    }),
  })
  .strict()
  .openapi("ServedPincode");

const serviceAreaRoute = createRoute({
  method: "get",
  path: "/api/service-area",
  summary: "Every pincode we hold, its city, and whether a technician goes there",
  responses: {
    200: {
      description: "Pincodes",
      ...json(
        z
          .object({
            pincodes: z.array(AreaSchema),
            cities: z.array(z.string()).openapi({ description: "Our cities, which a pincode added must be in." }),
          })
          .strict(),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const addPincodeRoute = createRoute({
  method: "post",
  path: "/api/pincodes",
  summary: "Add a pincode the service area does not hold, unserved, in one of our cities",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            pincode: z.string().regex(/^[1-8]\d{5}$/),
            area: z.string().trim().regex(AREA_NAME).openapi({ description: "What messages call the area." }),
            city: z.string().trim().min(1).max(60),
          })
          .strict()
          .openapi("NewPincode"),
      ),
    },
  },
  responses: {
    201: { description: "The pincode, as the service area now lists it", ...json(AreaSchema) },
    400: errorResponse("invalid_request: fields names the box refused, city for a city that is not one of ours"),
    403: errorResponse("access_required, or not_permitted: the city is outside the caller's Growth MANAGE"),
    409: errorResponse("pincode_held: the service area holds that pincode already"),
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
                    area: z.string().trim().regex(AREA_NAME).optional().openapi({
                      description: "A better name for the area than its post office's. Left out, the name stays.",
                    }),
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
      ...json(
        z
          .object({
            changed: z.number().int(),
            served: z.number().int(),
            alerted: z
              .number()
              .int()
              .openapi({ description: "Launch alerts queued for the pincodes it began serving." }),
          })
          .strict(),
      ),
    },
    400: errorResponse(
      "invalid_request: fields names a pincode we do not hold. launch_in_future: fields names a pincode it would " +
        "serve from a day still to come. no_service_area: it would leave none served",
    ),
    403: errorResponse("access_required"),
  },
});

/** A refused price as the API answers it: the box it names, and whether its service is retired by then. */
const priceRefused = (requestId: string, refusal: PriceRefusal) =>
  refusal.retired === true
    ? errorBody("service_retired", requestId, [refusal.field])
    : errorBody("invalid_request", requestId, [refusal.field]);

/** The keys a setting takes: those ops name themselves ("open"), these, or none for a single number. */
function keysOf(setting: NumberSetting): "open" | string[] | null {
  if (setting.keys === "open" || setting.keys === null) return setting.keys;
  return [...setting.keys];
}

/** Each key's own bounds, with the unit its figure counts in; null where every figure takes the rule's. */
function boundsBody(setting: NumberSetting) {
  if (setting.bounds === undefined) return null;
  return Object.fromEntries(Object.keys(setting.bounds).map((key) => [key, boundsOf(setting, key)]));
}

type State = Awaited<ReturnType<typeof settingStates>>[number];

const stateBody = ({ setting, value, setBy, setAt }: State) => {
  const described = {
    name: setting.name,
    title: setting.title,
    note: setting.note,
    set_by: setBy,
    set_at: setAt,
  };
  if (isChoice(setting)) {
    return {
      ...described,
      kind: "choice" as const,
      keys: [...setting.keys],
      choices: Object.fromEntries(Object.entries(setting.choices).map(([key, each]) => [key, [...each]])),
      value: value as Readonly<Record<string, string>>,
      default: setting.fallback,
    };
  }
  return {
    ...described,
    kind: "number" as const,
    unit: setting.unit,
    min: setting.min,
    max: setting.max,
    keys: keysOf(setting),
    bounds: boundsBody(setting),
    value: value as number | Readonly<Record<string, number>>,
    default: setting.fallback,
  };
};

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
        c.var.log.warn("setting_refused", { setting: setting.name, refusals: checked.refusals.length });
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
        actor: actorOf(c),
        requestId: c.var.requestId,
        now: c.var.deps.now(),
      });
    } else {
      await setOpsSetting(c.env.DB, {
        setting,
        value: null,
        actor: actorOf(c),
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
    if (result === "not_found") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (result === "not_to_come") {
      c.var.log.warn("price_correction_refused", { item: price.item });
      return c.json(errorBody("invalid_request", c.var.requestId, ["was_valid_from"]), 400);
    }
    return c.json({ prices: await priceBook(c.env.DB, today) }, 200);
  });

  app.openapi(withdrawPriceRoute, async (c) => {
    const now = c.var.deps.now();
    const row = c.req.valid("json");
    const result = await withdrawPrice(c.env.DB, { row, actor: actorOf(c), requestId: c.var.requestId, now });
    if (result === "not_found") return c.json(errorBody("not_found", c.var.requestId), 404);
    if (result === "not_to_come") {
      c.var.log.warn("price_withdrawal_refused", { item: row.item });
      return c.json(errorBody("invalid_request", c.var.requestId, ["valid_from"]), 400);
    }
    return c.json({ prices: await priceBook(c.env.DB, indiaDate(now)) }, 200);
  });

  app.openapi(serviceAreaRoute, async (c) => {
    const [pincodes, cities] = await Promise.all([serviceArea(c.env.DB), listCities(c.env.DB)]);
    return c.json({ pincodes, cities: cities.map((city) => city.name) }, 200);
  });

  app.openapi(setServiceAreaRoute, async (c) => {
    const result = await setServiceArea(c.env.DB, {
      changes: c.req.valid("json").changes,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if ("kind" in result) {
      c.var.log.warn("service_area_refused", { reason: result.kind });
      if (result.kind === "empty_area") return c.json(errorBody("no_service_area", c.var.requestId), 400);
      if (result.kind === "launch_in_future") {
        return c.json(errorBody("launch_in_future", c.var.requestId, result.pincodes), 400);
      }
      return c.json(errorBody("invalid_request", c.var.requestId, result.pincodes), 400);
    }
    await queuePacedMessages(c, result.alerts);
    return c.json({ changed: result.changed.length, served: result.served, alerted: result.alerts.length }, 200);
  });

  app.openapi(addPincodeRoute, async (c) => {
    const pincode = c.req.valid("json");
    // Whether we serve a pincode is no secret, as the site says so to anyone, so one elsewhere is refused, not hidden.
    if (!reachesCity(await routeReach(c), pincode.city)) {
      return c.json(errorBody("not_permitted", c.var.requestId), 403);
    }
    const added = await addPincode(c.env.DB, {
      pincode,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (added === "held") return c.json(errorBody("pincode_held", c.var.requestId), 409);
    if (added === "unknown_city") return c.json(errorBody("invalid_request", c.var.requestId, ["city"]), 400);
    return c.json(added, 201);
  });
}
