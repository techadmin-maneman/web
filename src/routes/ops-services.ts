// The services clients book, behind Access (docs/decisions/0085-services-ops-can-edit.md): each kind of visit's
// services, with every price each has had, is to have, and has now, and the two late fees beside their kinds.
//
//   GET  /api/services                            every service, offered or retired, and its dated prices
//   POST /api/services                            a service added to a kind
//   POST /api/services/{kind}/{tier}/name         renamed; its code, and so its prices, stay
//   POST /api/services/{kind}/{tier}/description  the line clients read under its name
//   POST /api/services/{kind}/{tier}/length       how long it is booked for, from now on
//   POST /api/services/{kind}/order               a kind's services in another order
//   POST /api/services/{kind}/{tier}/retire       no longer offered from a day, today or later
//   POST /api/services/{kind}/{tier}/restore      offered again
//
// A kind is code, and so is what it decides: the technician's steps, the booking rules and the fees. Every change
// here is audited in the same batch as the change itself (ADR 0031), and nothing already sold moves with it: a hold
// keeps the service's price, late fee and length it was made with. Books' items follow the services at the hourly
// item check (src/domain/books-items.ts).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { PRICE_BOUNDS } from "../config/ops-settings.ts";
import { VISIT_BLOCKS } from "../config/scheduling.ts";
import { VISIT_TYPES, type VisitType } from "../config/visit-types.ts";
import { priceBook, type PriceRow } from "../domain/price-book.ts";
import {
  addService,
  allServices,
  describeService,
  renameService,
  reorderServices,
  restoreService,
  retireService,
  setServiceLength,
  type ServiceRefusal,
} from "../domain/services.ts";
import { actorOf } from "../http/audit.ts";
import type { App, AppEnv } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { json } from "../http/openapi.ts";
import { indiaDate } from "../lib/india-time.ts";
import { LATE_FEES } from "../policy/moving-a-visit.ts";
import { DESCRIPTION_LENGTH, isOffered, PRICE_TIER } from "../policy/services.ts";
import { SERVICE_MINUTES } from "../policy/visit-length.ts";
import { PriceRowSchema } from "./ops-settings.ts";

const Kind = z.enum(VISIT_TYPES);
const Tier = z.string().regex(PRICE_TIER);

const ServiceSchema = z
  .object({
    kind: Kind,
    tier: z
      .string()
      .openapi({ description: "Its code within its kind, which the price book prices it by; never changed." }),
    name: z.string(),
    description: z.union([z.string(), z.null()]).openapi({
      description: "The line clients read under its name as they choose; null until ops write one.",
    }),
    minutes: z.number().int().openapi({ description: "How long it is booked for, and the time the day keeps." }),
    sort: z.number().int(),
    retired_date: z.union([z.iso.date(), z.null()]).openapi({
      description: "India's date from which clients no longer see it or book it; null while it is offered.",
    }),
    offered: z.boolean().openapi({ description: "Offered today: not retired by today. Priced or not." }),
    updated_by: z.string(),
    updated_at: z.iso.datetime(),
    prices: z.array(PriceRowSchema).openapi({ description: "Every price it has had and is to have, newest first." }),
  })
  .strict()
  .openapi("OpsService");

const ServicesSchema = z
  .object({
    today: z.iso.date(),
    kinds: z
      .array(z.object({ kind: Kind, minutes: z.number().int() }).strict())
      .openapi({ description: "The four kinds, in their order, each with the length a new service of it starts at." }),
    services: z.array(ServiceSchema),
    late_fees: z
      .array(
        z
          .object({
            kind: Kind,
            item: z.enum(["late_fee_first_fit", "late_fee_replacement"]),
            prices: z.array(PriceRowSchema),
          })
          .strict(),
      )
      .openapi({
        description: "The two late fees, each one figure for its kind of visit, with every price it has had.",
      }),
    min_minutes: z.number().int(),
    max_minutes: z.number().int(),
    max_description: z.number().int().openapi({ description: "The most characters a description may have." }),
    max_amount_ex_gst: z.number().int(),
    max_gst_percent: z.number().int(),
  })
  .strict()
  .openapi("OpsServices");

const answered = { description: "Every service as it now stands", ...json(ServicesSchema) };
const refused = {
  400: errorResponse("invalid_request: fields names the box refused"),
  403: errorResponse("access_required"),
  404: errorResponse("not_found: no service of that kind has that code"),
  409: errorResponse(
    "service_exists: another service has the name, or its kind the code (fields names which); last_of_kind: its " +
      "kind would be left with nothing to book, which a first fit may be",
  ),
};
const Path = z.object({ kind: Kind, tier: Tier });

const servicesRoute = createRoute({
  method: "get",
  path: "/api/services",
  summary: "Every service, offered or retired, with every price it has had and is to have, and the late fees",
  responses: { 200: answered, 403: errorResponse("access_required") },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/services",
  summary: "Add a service to a kind of visit. Clients see it once it has a price",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            kind: Kind,
            name: z.string().max(60),
            tier: Tier.optional().openapi({ description: "Its code; left out, made from its name, e.g. premium." }),
            minutes: z.number().int().optional().openapi({ description: "Left out, its kind's length." }),
          })
          .strict()
          .openapi("ServiceAdd"),
      ),
    },
  },
  responses: { 201: answered, ...refused },
});

const renameRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/{tier}/name",
  summary: "Rename a service. Its code stays, and so do its prices and what was sold under them",
  request: {
    params: Path,
    body: {
      required: true,
      ...json(
        z
          .object({ name: z.string().max(60) })
          .strict()
          .openapi("ServiceRename"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const describeRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/{tier}/description",
  summary: "The line clients read under a service's name as they choose. An empty one clears it",
  request: {
    params: Path,
    body: {
      required: true,
      ...json(
        z
          .object({ description: z.string().max(DESCRIPTION_LENGTH) })
          .strict()
          .openapi("ServiceDescribe"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const lengthRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/{tier}/length",
  summary: "How long a service is booked for, from now on. A visit held or booked before keeps its own",
  request: {
    params: Path,
    body: { required: true, ...json(z.object({ minutes: z.number().int() }).strict().openapi("ServiceLength")) },
  },
  responses: { 200: answered, ...refused },
});

const orderRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/order",
  summary: "A kind's services in another order, as the console and the app list them",
  request: {
    params: z.object({ kind: Kind }),
    body: {
      required: true,
      ...json(
        z
          .object({
            tiers: z.array(Tier).min(1).max(64).openapi({ description: "Every one of the kind's codes, once." }),
          })
          .strict()
          .openapi("ServiceOrder"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const retireRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/{tier}/retire",
  summary: "Stop offering a service from a day, today or later. Nothing already sold changes",
  request: {
    params: Path,
    body: {
      required: true,
      ...json(
        z
          .object({ from: z.iso.date().openapi({ description: "India's date from which clients no longer see it." }) })
          .strict()
          .openapi("ServiceRetire"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const restoreRoute = createRoute({
  method: "post",
  path: "/api/services/{kind}/{tier}/restore",
  summary: "Offer a retired service again, or take back a retirement still to come",
  request: { params: Path },
  responses: { 200: answered, ...refused },
});

const LATE_FEE_KINDS = VISIT_TYPES.flatMap((kind) => {
  const item = LATE_FEES[kind];
  return item === undefined ? [] : [{ kind, item }];
});

/** Every service with its prices, and the late fees with theirs, as they stand today in India. */
async function servicesBody(c: Context<AppEnv>) {
  const today = indiaDate(c.var.deps.now());
  const [services, book] = await Promise.all([allServices(c.env.DB), priceBook(c.env.DB, today)]);
  const pricesOf = (item: string, tier: string): PriceRow[] =>
    book.filter((row) => row.item === item && row.tier === tier);
  return {
    today,
    kinds: VISIT_TYPES.map((kind) => ({ kind, minutes: VISIT_BLOCKS[kind].minutes })),
    services: services.map((service) => ({
      ...service,
      offered: isOffered(service.retired_date, today),
      prices: pricesOf(service.kind, service.tier),
    })),
    late_fees: LATE_FEE_KINDS.map(({ kind, item }) => ({ kind, item, prices: pricesOf(item, "standard") })),
    min_minutes: SERVICE_MINUTES.min,
    max_minutes: SERVICE_MINUTES.max,
    max_description: DESCRIPTION_LENGTH,
    max_amount_ex_gst: PRICE_BOUNDS.maxPaise,
    max_gst_percent: PRICE_BOUNDS.maxGstPercent,
  };
}

/** A refusal as the API answers it: the box it names, where it names one. */
function refusalBody(c: Context<AppEnv>, refusal: ServiceRefusal) {
  c.var.log.warn("service_refused", { reason: refusal.refused });
  const requestId = c.var.requestId;
  switch (refusal.refused) {
    case "invalid":
      return c.json(errorBody("invalid_request", requestId, [refusal.field]), 400);
    case "taken":
      return c.json(errorBody("service_exists", requestId, [refusal.field]), 409);
    case "last_of_kind":
      return c.json(errorBody("last_of_kind", requestId), 409);
    case "not_found":
      return c.json(errorBody("not_found", requestId), 404);
  }
}

/** A write's answer that is a refusal rather than the service, or services, it wrote. */
const isRefusal = (result: object): result is ServiceRefusal => "refused" in result;

const writeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsServices(app: App): void {
  app.openapi(servicesRoute, async (c) => c.json(await servicesBody(c), 200));

  app.openapi(addRoute, async (c) => {
    const { kind, name, tier, minutes } = c.req.valid("json");
    const added = await addService(c.env.DB, { ...writeOf(c), kind, name, tier, minutes });
    if (isRefusal(added)) return refusalBody(c, added);
    return c.json(await servicesBody(c), 201);
  });

  app.openapi(renameRoute, async (c) => {
    const { kind, tier } = c.req.valid("param");
    const renamed = await renameService(c.env.DB, { ...writeOf(c), kind, tier, name: c.req.valid("json").name });
    if (isRefusal(renamed)) return refusalBody(c, renamed);
    return c.json(await servicesBody(c), 200);
  });

  app.openapi(describeRoute, async (c) => {
    const { kind, tier } = c.req.valid("param");
    const description = c.req.valid("json").description;
    const described = await describeService(c.env.DB, { ...writeOf(c), kind, tier, description });
    if (isRefusal(described)) return refusalBody(c, described);
    return c.json(await servicesBody(c), 200);
  });

  app.openapi(lengthRoute, async (c) => {
    const { kind, tier } = c.req.valid("param");
    const minutes = c.req.valid("json").minutes;
    const changed = await setServiceLength(c.env.DB, { ...writeOf(c), kind, tier, minutes });
    if (isRefusal(changed)) return refusalBody(c, changed);
    return c.json(await servicesBody(c), 200);
  });

  app.openapi(orderRoute, async (c) => {
    const kind: VisitType = c.req.valid("param").kind;
    const ordered = await reorderServices(c.env.DB, { ...writeOf(c), kind, tiers: c.req.valid("json").tiers });
    if (isRefusal(ordered)) return refusalBody(c, ordered);
    return c.json(await servicesBody(c), 200);
  });

  app.openapi(retireRoute, async (c) => {
    const { kind, tier } = c.req.valid("param");
    const write = writeOf(c);
    const from = c.req.valid("json").from;
    const retired = await retireService(c.env.DB, { ...write, kind, tier, from, today: indiaDate(write.now) });
    if (isRefusal(retired)) return refusalBody(c, retired);
    return c.json(await servicesBody(c), 200);
  });

  app.openapi(restoreRoute, async (c) => {
    const { kind, tier } = c.req.valid("param");
    const restored = await restoreService(c.env.DB, { ...writeOf(c), kind, tier });
    if (isRefusal(restored)) return refusalBody(c, restored);
    return c.json(await servicesBody(c), 200);
  });
}
