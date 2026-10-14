// Admin › Cities, behind Access (docs/decisions/0198-cities-as-data.md):
//   GET    /api/cities                                        every city, its state and zone, the GST registrations,
//                                                            and each city's own rules and prices
//   POST   /api/cities                                        a city added
//   PATCH  /api/cities/{name}                                 a city changed, or renamed with every row naming it
//   PATCH  /api/cities/{name}/rules/{rule}                    a rule the city sets for itself
//   DELETE /api/cities/{name}/rules/{rule}                    the national rule back in the city
//   POST   /api/cities/{name}/prices                          a price of the city's own, from a day
//   DELETE /api/cities/{name}/prices/{item}/{tier}/{from}     one still to come taken back
//   POST   /api/gst-registrations                             a state's GST registration, or a change to it
//   DELETE /api/gst-registrations/{state}                     a state's registration taken off
// Every change is audited under the member of staff who made it, in the same batch.

import { createRoute, z } from "@hono/zod-openapi";
import { GSTIN_FORMAT, STATE_CODE_FORMAT } from "../../config/gst.ts";
import { addCity, changeCity, type CityFields } from "../../domain/cities/city-changes.ts";
import { allCities, cityNamed } from "../../domain/cities/cities.ts";
import { cityPrices, setCityPrice, withdrawCityPrice } from "../../domain/money/city-prices.ts";
import { cityRules, setCityRule } from "../../domain/cities/city-rules.ts";
import { removeRegistration, setRegistration, stateRegistrations } from "../../domain/cities/gst-registrations.ts";
import { PRICE_ITEMS } from "../../domain/money/price-book.ts";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorBody, errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { CITY_SETTING_NAMES } from "../../policy/city-settings.ts";
import { PRICE_BOUNDS } from "../../policy/ops-settings.ts";
import { PRICE_TIER } from "../../policy/services.ts";

/** A city's name as the console shows it: letters, spaces, dots, hyphens and apostrophes. */
const CITY_NAME = /^\p{L}[\p{L} .'-]{0,59}$/u;

const CitySchema = z
  .object({
    name: z.string(),
    state_code: z.union([z.string(), z.null()]).openapi({ description: "The state's GST code, as HR." }),
    state: z.union([z.string(), z.null()]),
    zone: z.union([z.string(), z.null()]).openapi({ description: "The zone a grant of staff access may name." }),
    served: z.boolean().openapi({ description: "Whether we go there: its pincodes may be served." }),
    active: z.boolean().openapi({ description: "Whether it is offered at all: on the forms and the board." }),
    sort: z.number().int(),
  })
  .strict()
  .openapi("City");

const CityFieldsSchema = z
  .object({
    name: z.string().trim().regex(CITY_NAME),
    state_code: z.string().regex(STATE_CODE_FORMAT),
    state: z.string().trim().min(1).max(60),
    zone: z.union([z.string().trim().min(1).max(60), z.null()]),
    served: z.boolean(),
    active: z.boolean(),
  })
  .strict()
  .openapi("CityFields");

const RegistrationSchema = z
  .object({
    state_code: z.string(),
    gstin: z.string(),
    books_branch_id: z.union([z.string(), z.null()]).openapi({
      description: "The Books branch its invoices are raised under; null for an organisation with no branches.",
    }),
    added_by: z.string(),
    added_at: z.iso.datetime(),
  })
  .strict()
  .openapi("GstRegistration");

const CityPriceSchema = z
  .object({
    city: z.string(),
    item: z.enum(PRICE_ITEMS),
    tier: z.string(),
    amount_ex_gst: z.number().int(),
    gst_percent: z.number().int(),
    valid_from: z.iso.date(),
    in_force: z.boolean(),
  })
  .strict()
  .openapi("CityPrice");

const RuleValue = z
  .union([z.number(), z.record(z.string(), z.number())])
  .openapi({ description: "As the national rule takes it: one figure, or one per key." });

const citiesRoute = createRoute({
  method: "get",
  path: "/api/cities",
  summary: "Every city, its state and zone, the GST registrations, and each city's own rules and prices",
  responses: {
    200: {
      description: "Cities",
      ...json(
        z
          .object({
            cities: z.array(CitySchema),
            zones: z.array(z.string()),
            registrations: z.array(RegistrationSchema),
            rules: z.array(z.object({ city: z.string(), rule: z.enum(CITY_SETTING_NAMES), value: RuleValue }).strict()),
            rule_names: z.array(z.enum(CITY_SETTING_NAMES)).openapi({ description: "The rules a city may set." }),
            prices: z.array(CityPriceSchema),
            today: z.iso.date(),
          })
          .strict()
          .openapi("Cities"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const cityAnswer = (description: string) => ({
  description,
  ...json(z.object({ city: CitySchema }).strict()),
});

const addRoute = createRoute({
  method: "post",
  path: "/api/cities",
  summary: "A city added, last in the order",
  request: { body: { required: true, ...json(CityFieldsSchema) } },
  responses: {
    201: cityAnswer("The city added"),
    400: errorResponse("invalid_request: fields names what was refused, zone where it is none of ours"),
    403: errorResponse("access_required"),
    409: errorResponse("taken: another city has that name"),
  },
});

const NameParam = z.object({ name: z.string().min(1).max(60) });

const changeRoute = createRoute({
  method: "patch",
  path: "/api/cities/{name}",
  summary: "A city changed; a new name moves every row that names it, in one batch",
  request: { params: NameParam, body: { required: true, ...json(CityFieldsSchema) } },
  responses: {
    200: cityAnswer("The city as it now stands"),
    400: errorResponse("invalid_request: fields names what was refused, zone where it is none of ours"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such city"),
    409: errorResponse("taken: another city has the new name"),
  },
});

const RuleParams = z.object({ name: z.string().min(1).max(60), rule: z.enum(CITY_SETTING_NAMES) });

const setRuleRoute = createRoute({
  method: "patch",
  path: "/api/cities/{name}/rules/{rule}",
  summary: "A rule the city sets for itself, checked as the national rule is",
  request: {
    params: RuleParams,
    body: { required: true, ...json(z.object({ value: RuleValue }).strict().openapi("CityRule")) },
  },
  responses: {
    200: {
      description: "The rule as the city now sets it",
      ...json(z.object({ city: z.string(), rule: z.enum(CITY_SETTING_NAMES), value: RuleValue }).strict()),
    },
    400: errorResponse("invalid_request: fields names the figure refused"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such city"),
  },
});

const clearRuleRoute = createRoute({
  method: "delete",
  path: "/api/cities/{name}/rules/{rule}",
  summary: "The national rule back in the city",
  request: { params: RuleParams },
  responses: {
    204: { description: "The city follows the national rule" },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such city"),
  },
});

const setPriceRoute = createRoute({
  method: "post",
  path: "/api/cities/{name}/prices",
  summary: "A price of the city's own from a day, tomorrow at the earliest, before the book's there",
  request: {
    params: NameParam,
    body: {
      required: true,
      ...json(
        z
          .object({
            item: z.enum(PRICE_ITEMS),
            tier: z.string().regex(PRICE_TIER),
            amount_ex_gst: z.number().int().min(PRICE_BOUNDS.minPaise).max(PRICE_BOUNDS.maxPaise),
            gst_percent: z.number().int().min(PRICE_BOUNDS.minGstPercent).max(PRICE_BOUNDS.maxGstPercent),
            valid_from: z.iso.date(),
          })
          .strict()
          .openapi("CityPriceChange"),
      ),
    },
  },
  responses: {
    201: { description: "The price set", ...json(z.object({ price: CityPriceSchema }).strict()) },
    400: errorResponse("invalid_request: fields names what was refused; service_retired: retired by then"),
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such city"),
  },
});

const withdrawPriceRoute = createRoute({
  method: "delete",
  path: "/api/cities/{name}/prices/{item}/{tier}/{valid_from}",
  summary: "A city's price still to come taken back. The one in force and the spent ones stay",
  request: {
    params: z.object({
      name: z.string().min(1).max(60),
      item: z.enum(PRICE_ITEMS),
      tier: z.string().regex(PRICE_TIER),
      valid_from: z.iso.date(),
    }),
  },
  responses: {
    204: { description: "Taken back" },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: the city holds no such price still to come"),
  },
});

const setRegistrationRoute = createRoute({
  method: "post",
  path: "/api/gst-registrations",
  summary: "A state's GST registration, or a change to it: its visits are supplied from it",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            state_code: z.string().regex(STATE_CODE_FORMAT),
            gstin: z.string().regex(GSTIN_FORMAT),
            books_branch_id: z.union([z.string().trim().min(1).max(40), z.null()]),
          })
          .strict()
          .openapi("GstRegistrationChange"),
      ),
    },
  },
  responses: {
    201: {
      description: "The registrations as they now stand",
      ...json(z.object({ registrations: z.array(RegistrationSchema) }).strict()),
    },
    400: errorResponse("invalid_request"),
    403: errorResponse("access_required"),
    409: errorResponse("taken: another state has that GSTIN"),
  },
});

const removeRegistrationRoute = createRoute({
  method: "delete",
  path: "/api/gst-registrations/{state_code}",
  summary: "A state's registration taken off: its visits are supplied from the registration in BOOKS_GSTIN again",
  request: { params: z.object({ state_code: z.string().regex(STATE_CODE_FORMAT) }) },
  responses: {
    204: { description: "Taken off" },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no registration for that state"),
  },
});

const fieldsOf = (body: z.infer<typeof CityFieldsSchema>): CityFields => ({
  name: body.name,
  stateCode: body.state_code,
  state: body.state,
  zone: body.zone,
  served: body.served,
  active: body.active,
});

export function registerOpsCities(app: App): void {
  app.openapi(citiesRoute, async (c) => {
    const db = c.env.DB;
    const today = indiaDate(c.var.deps.now());
    const [cities, zones, registrations, rules, prices] = await Promise.all([
      allCities(db),
      db.prepare("SELECT name FROM zones ORDER BY sort, name").all<{ name: string }>(),
      stateRegistrations(db),
      cityRules(db),
      cityPrices(db, today),
    ]);
    const ruleRows = [...rules].flatMap(([city, set]) =>
      CITY_SETTING_NAMES.flatMap((rule) => {
        const value = set[rule];
        return typeof value === "number" || (typeof value === "object" && isFigures(value))
          ? [{ city, rule, value }]
          : [];
      }),
    );
    return c.json(
      {
        cities,
        zones: zones.results.map((row) => row.name),
        registrations,
        rules: ruleRows,
        rule_names: [...CITY_SETTING_NAMES],
        prices,
        today,
      },
      200,
    );
  });

  registerCityChanges(app);
  registerCityRules(app);
  registerCityPrices(app);
  registerRegistrations(app);
}

/** One figure per key, as a rule of figures holds them. */
const isFigures = (value: object): value is Readonly<Record<string, number>> =>
  Object.values(value).every((each) => typeof each === "number");

const auditOf = (c: Parameters<typeof actorOf>[0]) =>
  ({ surface: "ops", actor: actorOf(c), requestId: c.var.requestId }) as const;

function registerCityChanges(app: App): void {
  app.openapi(addRoute, async (c) => {
    const added = await addCity(c.env.DB, fieldsOf(c.req.valid("json")), auditOf(c), c.var.deps.now());
    if (added === "unknown_zone") return refuse(c, "invalid_request", ["zone"]);
    if (added === "held") return refuse(c, "taken");
    return c.json({ city: added }, 201);
  });

  app.openapi(changeRoute, async (c) => {
    const change = { was: c.req.valid("param").name, fields: fieldsOf(c.req.valid("json")) };
    const changed = await changeCity(c.env.DB, change, auditOf(c), c.var.deps.now());
    if (changed === "unknown_zone") return refuse(c, "invalid_request", ["zone"]);
    if (changed === "held") return refuse(c, "taken");
    if (changed === "not_found") return refuse(c, "not_found");
    return c.json({ city: changed }, 200);
  });
}

function registerCityRules(app: App): void {
  app.openapi(setRuleRoute, async (c) => {
    const { name, rule } = c.req.valid("param");
    if ((await cityNamed(c.env.DB, name)) === null) return refuse(c, "not_found");
    const { value } = c.req.valid("json");
    const refusal = await setCityRule(c.env.DB, { city: name, name: rule, value }, auditOf(c), c.var.deps.now());
    if (refusal !== null) return refuse(c, "invalid_request", refusal.kind === "refused" ? refusal.fields : ["rule"]);
    return c.json({ city: name, rule, value }, 200);
  });

  app.openapi(clearRuleRoute, async (c) => {
    const { name, rule } = c.req.valid("param");
    if ((await cityNamed(c.env.DB, name)) === null) return refuse(c, "not_found");
    await setCityRule(c.env.DB, { city: name, name: rule, value: null }, auditOf(c), c.var.deps.now());
    return c.body(null, 204);
  });
}

function registerCityPrices(app: App): void {
  app.openapi(setPriceRoute, async (c) => {
    const { name } = c.req.valid("param");
    if ((await cityNamed(c.env.DB, name)) === null) return refuse(c, "not_found");
    const body = c.req.valid("json");
    const now = c.var.deps.now();
    const today = indiaDate(now);
    const refusal = await setCityPrice(c.env.DB, { ...body, city: name }, auditOf(c), { now, today });
    if (refusal !== null) {
      const code = refusal.retired === true ? "service_retired" : "invalid_request";
      return c.json(errorBody(code, c.var.requestId, [refusal.field]), 400);
    }
    const price = (await cityPrices(c.env.DB, today)).find(
      (each) =>
        each.city === name && each.item === body.item && each.tier === body.tier && each.valid_from === body.valid_from,
    );
    if (price === undefined) return refuse(c, "not_found");
    return c.json({ price }, 201);
  });

  app.openapi(withdrawPriceRoute, async (c) => {
    const { name, item, tier, valid_from } = c.req.valid("param");
    const now = c.var.deps.now();
    const withdrawn = await withdrawCityPrice(c.env.DB, { city: name, item, tier, valid_from }, auditOf(c), {
      now,
      today: indiaDate(now),
    });
    return withdrawn ? c.body(null, 204) : refuse(c, "not_found");
  });
}

function registerRegistrations(app: App): void {
  app.openapi(setRegistrationRoute, async (c) => {
    const body = c.req.valid("json");
    const set = await setRegistration(
      c.env.DB,
      { stateCode: body.state_code, gstin: body.gstin, booksBranchId: body.books_branch_id },
      auditOf(c),
      c.var.deps.now(),
    );
    if (set === "held") return refuse(c, "taken");
    return c.json({ registrations: await stateRegistrations(c.env.DB) }, 201);
  });

  app.openapi(removeRegistrationRoute, async (c) => {
    const removed = await removeRegistration(c.env.DB, c.req.valid("param").state_code, auditOf(c), c.var.deps.now());
    return removed ? c.body(null, 204) : refuse(c, "not_found");
  });
}
