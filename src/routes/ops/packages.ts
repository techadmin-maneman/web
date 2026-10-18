// Packages in the console, behind Access (docs/decisions/0211-packages.md): each package with its hair systems, its
// service visit and its replacement, every figure and every price each has had, is to have and has now.
//
// A package is added, changed a box at a time, put in order, retired from a day, offered again, and deleted while
// nothing was sold under it. Its prices are set as every price is (./prices.ts): its service visit's and its
// replacement's under their kinds, each hair system's under hair_system. Every write answers the whole of GET's
// answer, so the screen follows it without reading again.

import { opsInputs } from "../../http/ops-inputs.ts";
import { opsRoute } from "../../http/session-routes.ts";
import { withGst } from "../../config/gst.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  addPackage,
  changePackage,
  deletePackage,
  hairSystemsOfPackages,
  packagesInUse,
  reorderPackages,
  type HairSystemOfPackage,
  type PackageRefusal,
} from "../../domain/booking/packages-console.ts";
import { allPackages, type Package } from "../../domain/booking/packages.ts";
import { restoreService, retireService, servicesOnDay, type ServiceRefusal } from "../../domain/booking/services.ts";
import { hairSystemPricesOn } from "../../domain/money/hair-system-prices.ts";
import { priceBook, type PriceRow } from "../../domain/money/price-book.ts";
import type { Price } from "../../domain/money/price-lookup.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { PRICE_BOUNDS } from "../../policy/ops-settings.ts";
import { REPLACE_AFTER_MONTHS, SERVICE_EVERY_DAYS } from "../../policy/packages.ts";
import { DESCRIPTION_LENGTH, isOffered, PRICE_TIER } from "../../policy/services.ts";
import { SERVICE_MINUTES } from "../../policy/visit-length.ts";
import { PriceRowSchema } from "../schemas/prices.ts";

const PriceNowSchema = z
  .object({
    amount_ex_gst: z.number().int().openapi({ description: "In paise, before GST." }),
    amount: z.number().int().openapi({ description: "In paise, GST included." }),
    gst_percent: z.number().int(),
  })
  .strict()
  .openapi("PriceNow");

const PriceToday = z.union([PriceNowSchema, z.null()]);

const HairSystemSchema = z
  .object({
    code: z.string().openapi({ description: "Its stock code, which the price book prices it under." }),
    name: z.string(),
    base_width_in: z.number(),
    base_length_in: z.number(),
    colour: z.string(),
    grey_percent: z.number().int(),
    density_percent: z.number().int(),
    unit_cost: z.number().int().openapi({ description: "What one costs us, in paise." }),
    retired_date: z.union([z.iso.date(), z.null()]),
    offered: z.boolean(),
    used: z
      .boolean()
      .openapi({ description: "Stock of it has moved or a job used it: it may be retired, not deleted." }),
    price: PriceToday.openapi({ description: "What it sells for today; null while it has no price." }),
    prices: z.array(PriceRowSchema),
  })
  .strict()
  .openapi("PackageHairSystem");

const PackageSchema = z
  .object({
    code: z.string().openapi({ description: "The code its services and hair systems name it by; never changed." }),
    name: z.string(),
    description: z.union([z.string(), z.null()]),
    sort: z.number().int(),
    retired_date: z.union([z.iso.date(), z.null()]).openapi({
      description: "India's date from which it is no longer sold; null while it is. Its clients keep their visits.",
    }),
    offered: z
      .boolean()
      .openapi({ description: "Sold today: not retired, and a hair system and its service visit priced." }),
    deletable: z.boolean().openapi({ description: "Nothing sold under it, no client on it, no hair system in it." }),
    first_fit: z
      .object({
        minutes: z.number().int(),
        from: PriceToday.openapi({ description: "Its cheapest hair system and its service visit, today." }),
      })
      .strict(),
    service: z
      .object({
        minutes: z.number().int(),
        every_days: z.number().int(),
        price: PriceToday,
        prices: z.array(PriceRowSchema),
      })
      .strict(),
    replacement: z
      .object({
        minutes: z.number().int(),
        after_months: z.number().int(),
        price: PriceToday.openapi({ description: "The replacement alone, today." }),
        total: PriceToday.openapi({ description: "The replacement and its service visit, as it is sold today." }),
        prices: z.array(PriceRowSchema),
      })
      .strict(),
    hair_systems: z.array(HairSystemSchema),
    updated_by: z.string(),
    updated_at: z.iso.datetime(),
  })
  .strict()
  .openapi("Package");

const PackagesSchema = z
  .object({
    today: z.iso.date(),
    packages: z.array(PackageSchema),
    min_minutes: z.number().int(),
    max_minutes: z.number().int(),
    min_every_days: z.number().int(),
    max_every_days: z.number().int(),
    min_after_months: z.number().int(),
    max_after_months: z.number().int(),
    max_description: z.number().int(),
    max_amount_ex_gst: z.number().int(),
    max_gst_percent: z.number().int(),
  })
  .strict()
  .openapi("Packages");

const answered = { description: "Every package as it now stands", ...json(PackagesSchema) };
const refused = {
  400: errorResponse("invalid_request: fields names the box refused"),
  404: errorResponse("not_found: no package has that code"),
  409: errorResponse(
    "service_exists: another service has one of its names, or another package its code (fields names which); " +
      "in_use: something was sold under it, a client is on it or a hair system is in it, so it is retired instead",
  ),
};

const Code = z.object({ code: z.string().regex(PRICE_TIER) });

const listRoute = opsRoute({
  method: "get",
  path: "/api/packages",
  summary: "Every package with its hair systems, service visit and replacement, and every price each has had",
  responses: { 200: answered },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/packages",
  summary: "Add a package. Clients see it once a hair system and its service visit have prices",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            name: z.string().max(60),
            code: z.string().regex(PRICE_TIER).optional().openapi({ description: "Left out, made from its name." }),
          })
          .strict()
          .openapi("PackageAdd"),
      ),
    },
  },
  responses: { 201: answered, ...refused },
});

const changeRoute = opsRoute({
  method: "patch",
  path: "/api/packages/{code}",
  summary: "Change what ops set of a package, a box or more at a time. Visits already booked keep their lengths",
  request: {
    params: Code,
    body: {
      required: true,
      ...json(
        z
          .object({
            name: z.string().max(60).optional(),
            description: z.string().max(DESCRIPTION_LENGTH).optional(),
            first_fit_minutes: z.number().int().optional(),
            service_minutes: z.number().int().optional(),
            service_every_days: z.number().int().optional(),
            replacement_minutes: z.number().int().optional(),
            replace_after_months: z.number().int().optional(),
          })
          .strict()
          .openapi("PackageChange"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const orderRoute = opsRoute({
  method: "post",
  path: "/api/packages/order",
  summary: "The packages in another order, as the console, the app and the site list them",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ codes: z.array(z.string().regex(PRICE_TIER)).min(1).max(64) })
          .strict()
          .openapi("PackageOrder"),
      ),
    },
  },
  responses: { 200: answered, ...refused },
});

const retireRoute = opsRoute({
  method: "post",
  path: "/api/packages/{code}/retire",
  summary: "Stop selling a package from a day, today or later. Its clients keep their service visits and replacements",
  request: {
    params: Code,
    body: {
      required: true,
      ...json(z.object({ from: z.iso.date() }).strict().openapi("PackageRetire")),
    },
  },
  responses: { 200: answered, ...refused },
});

const restoreRoute = opsRoute({
  method: "post",
  path: "/api/packages/{code}/restore",
  summary: "Sell a retired package again, or take back a retirement still to come",
  request: { params: Code },
  responses: { 200: answered, ...refused },
});

const deleteRoute = opsRoute({
  method: "delete",
  path: "/api/packages/{code}",
  summary: "Delete a package added by mistake, while nothing was sold under it",
  request: { params: Code },
  responses: { 204: { description: "Deleted" }, ...refused },
});

const priceNow = (price: Price | null) =>
  price === null ? null : { amount_ex_gst: price.amount_ex_gst, amount: price.amount, gst_percent: price.gst_percent };

/** A package's hair system as the page lists it, with its price today and every price it has had. */
function hairSystemOf(
  piece: HairSystemOfPackage,
  {
    today,
    pricesOf,
    priceToday,
  }: { today: string; pricesOf: (item: string, tier: string) => PriceRow[]; priceToday: Price | null },
) {
  return {
    code: piece.code,
    name: piece.name,
    base_width_in: piece.baseWidthIn,
    base_length_in: piece.baseLengthIn,
    colour: piece.colour,
    grey_percent: piece.greyPercent,
    density_percent: piece.densityPercent,
    unit_cost: piece.unitCost,
    retired_date: piece.retiredDate,
    offered: isOffered(piece.retiredDate, today),
    used: piece.used,
    price: priceNow(priceToday),
    prices: pricesOf("hair_system", piece.code),
  };
}

/** Every package with its parts, as they stand today in India. */
async function packagesBody(c: Context<AppEnv>) {
  const db = c.env.DB;
  const today = indiaDate(c.var.deps.now());
  const [packages, book, services, pieces, piecePrices, inUse] = await Promise.all([
    allPackages(db),
    priceBook(db, today),
    servicesOnDay(db, today),
    hairSystemsOfPackages(db),
    hairSystemPricesOn(db, today),
    packagesInUse(db),
  ]);
  const pricesOf = (item: string, tier: string): PriceRow[] =>
    book.filter((row) => row.item === item && row.tier === tier);
  const ownPrice = (item: string, tier: string): Price | null => {
    const row = pricesOf(item, tier).find((each) => each.in_force);
    if (row === undefined) return null;
    return {
      amount_ex_gst: row.amount_ex_gst,
      amount: withGst(row.amount_ex_gst, row.gst_percent),
      gst_percent: row.gst_percent,
    };
  };
  const sold = (kind: string, code: string) =>
    services.find((service) => service.kind === kind && service.tier === code)?.price ?? null;
  return {
    today,
    packages: packages.map((each: Package) => ({
      code: each.code,
      name: each.name,
      description: each.description,
      sort: each.sort,
      retired_date: each.retired_date,
      offered: isOffered(each.retired_date, today) && sold("first_fit", each.code) !== null,
      deletable: !inUse.has(each.code),
      first_fit: { minutes: each.first_fit_minutes, from: priceNow(sold("first_fit", each.code)) },
      service: {
        minutes: each.service_minutes,
        every_days: each.service_every_days,
        price: priceNow(sold("service", each.code)),
        prices: pricesOf("service", each.code),
      },
      replacement: {
        minutes: each.replacement_minutes,
        after_months: each.replace_after_months,
        price: priceNow(ownPrice("replacement", each.code)),
        total: priceNow(sold("replacement", each.code)),
        prices: pricesOf("replacement", each.code),
      },
      hair_systems: pieces
        .filter((piece) => piece.product === each.code)
        .map((piece) =>
          hairSystemOf(piece, {
            today,
            pricesOf,
            priceToday: piecePrices.find((priced) => priced.code === piece.code)?.price ?? null,
          }),
        ),
      updated_by: each.updated_by,
      updated_at: each.updated_at,
    })),
    min_minutes: SERVICE_MINUTES.min,
    max_minutes: SERVICE_MINUTES.max,
    min_every_days: SERVICE_EVERY_DAYS.min,
    max_every_days: SERVICE_EVERY_DAYS.max,
    min_after_months: REPLACE_AFTER_MONTHS.min,
    max_after_months: REPLACE_AFTER_MONTHS.max,
    max_description: DESCRIPTION_LENGTH,
    max_amount_ex_gst: PRICE_BOUNDS.maxPaise,
    max_gst_percent: PRICE_BOUNDS.maxGstPercent,
  };
}

/** A refusal as the API answers it: the box it names, where it names one. */
function refusalBody(c: Context<AppEnv>, refusal: PackageRefusal | ServiceRefusal) {
  c.var.log.warn("package_refused", { reason: refusal.refused });
  switch (refusal.refused) {
    case "invalid":
      return refuse(c, "invalid_request", [refusal.field]);
    case "taken":
      return refuse(c, "service_exists", [refusal.field]);
    case "in_use":
      return refuse(c, "in_use");
    case "last_of_kind":
      return refuse(c, "last_of_kind");
    case "not_found":
      return refuse(c, "not_found");
  }
}

const isRefusal = (result: unknown): result is PackageRefusal | ServiceRefusal =>
  typeof result === "object" && result !== null && "refused" in result;

const writeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsPackages(app: App): void {
  app.openapi(listRoute, async (c) => c.json(await packagesBody(c), 200));

  app.openapi(addRoute, async (c) => {
    const { name, code } = c.req.valid("json");
    const added = await addPackage(c.env.DB, { ...writeOf(c), name, code });
    if (isRefusal(added)) return refusalBody(c, added);
    return c.json(await packagesBody(c), 201);
  });

  app.openapi(changeRoute, async (c) => {
    const { code } = c.req.valid("param");
    const { nextVisitDays } = await opsInputs(c);
    const changes = c.req.valid("json");
    const changed = await changePackage(c.env.DB, { ...writeOf(c), code, changes, horizon: nextVisitDays.horizon });
    if (isRefusal(changed)) return refusalBody(c, changed);
    return c.json(await packagesBody(c), 200);
  });

  app.openapi(orderRoute, async (c) => {
    const ordered = await reorderPackages(c.env.DB, { ...writeOf(c), codes: c.req.valid("json").codes });
    if (isRefusal(ordered)) return refusalBody(c, ordered);
    return c.json(await packagesBody(c), 200);
  });

  app.openapi(retireRoute, async (c) => {
    const { code } = c.req.valid("param");
    const write = writeOf(c);
    const today = indiaDate(write.now);
    const from = c.req.valid("json").from;
    const retired = await retireService(c.env.DB, { ...write, kind: "first_fit", tier: code, from, today });
    if (isRefusal(retired)) return refusalBody(c, retired);
    return c.json(await packagesBody(c), 200);
  });

  app.openapi(restoreRoute, async (c) => {
    const { code } = c.req.valid("param");
    const restored = await restoreService(c.env.DB, { ...writeOf(c), kind: "first_fit", tier: code });
    if (isRefusal(restored)) return refusalBody(c, restored);
    return c.json(await packagesBody(c), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { code } = c.req.valid("param");
    const deleted = await deletePackage(c.env.DB, { ...writeOf(c), code });
    if (isRefusal(deleted)) return refusalBody(c, deleted);
    return c.body(null, 204);
  });
}
