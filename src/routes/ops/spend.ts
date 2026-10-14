// Offline spend, behind Access (Growth; docs/decisions/0150-spend.md).

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { addSpend, removeSpend, spendSince } from "../../domain/money/spend.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { addMonths, indiaDate, monthOf } from "../../lib/india-time.ts";
import { SPEND_CHANNELS } from "../../policy/channels.ts";

/** How far back the page lists, and how far back an entry may be put. */
const MONTHS_LISTED = 13;

const SpendEntrySchema = z
  .object({
    id: z.uuid(),
    month: z.string().openapi({ description: "YYYY-MM." }),
    city: z.union([z.string(), z.null()]).openapi({ description: "Null for spend not aimed at one city." }),
    channel: z.enum(SPEND_CHANNELS),
    campaign: z.union([z.string(), z.null()]),
    amount: z.number().int().openapi({ description: "Paise, before GST." }),
    note: z.union([z.string(), z.null()]),
    entered_by: z.string(),
    entered_at: z.iso.datetime(),
  })
  .strict()
  .openapi("SpendEntry");

const listRoute = createRoute({
  method: "get",
  path: "/api/spend",
  summary: "The last thirteen months' offline spend, the latest month first",
  responses: {
    200: {
      description: "The entries, and the cities and channels an entry may name",
      ...json(
        z
          .object({
            entries: z.array(SpendEntrySchema),
            cities: z.array(z.string()),
            channels: z.array(z.enum(SPEND_CHANNELS)),
            first_month: z.string().openapi({ description: "The earliest month an entry may be put in, YYYY-MM." }),
            this_month: z.string().openapi({ description: "India's month now, the latest an entry may be put in." }),
          })
          .strict()
          .openapi("SpendList"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/spend",
  summary: "Add a month's offline spend",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            city: z.union([z.string().trim().min(1).max(60), z.null()]),
            channel: z.enum(SPEND_CHANNELS),
            campaign: z.string().trim().min(1).max(120).optional().openapi({
              description: "As the campaign is named, starting with its city or with national.",
            }),
            amount: z.number().int().min(100).max(10_000_000_000).openapi({ description: "Paise, before GST." }),
            note: z.string().trim().min(1).max(200).optional(),
          })
          .strict()
          .openapi("SpendNew"),
      ),
    },
  },
  responses: {
    200: { description: "Added", ...json(SpendEntrySchema) },
    400: errorResponse(
      "invalid_request: fields names month for one outside the list's months, or city for one we do not hold",
    ),
    403: errorResponse("access_required"),
  },
});

const removeRoute = createRoute({
  method: "post",
  path: "/api/spend/{id}/remove",
  summary: "Take an entry off the figures",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Taken off", ...json(z.object({ ok: z.literal(true) }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such entry on the figures"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

/** India's month now, and the earliest the page lists. */
const monthsOf = (now: Date) => {
  const thisMonth = monthOf(indiaDate(now));
  return { thisMonth, firstMonth: addMonths(thisMonth, 1 - MONTHS_LISTED) };
};

export function registerOpsSpend(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { thisMonth, firstMonth } = monthsOf(c.var.deps.now());
    const [entries, cities] = await Promise.all([
      spendSince(c.env.DB, firstMonth),
      c.env.DB.prepare("SELECT name FROM cities ORDER BY sort").all<{ name: string }>(),
    ]);
    return c.json(
      {
        entries,
        cities: cities.results.map((city) => city.name),
        channels: [...SPEND_CHANNELS],
        first_month: firstMonth,
        this_month: thisMonth,
      },
      200,
    );
  });

  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const { thisMonth, firstMonth } = monthsOf(c.var.deps.now());
    if (body.month < firstMonth || body.month > thisMonth) return refuse(c, "invalid_request", ["month"]);
    const added = await addSpend(c.env.DB, {
      ...changeOf(c),
      month: body.month,
      city: body.city,
      channel: body.channel,
      campaign: body.campaign ?? null,
      amount: body.amount,
      note: body.note ?? null,
    });
    if (added === "no_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(added, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const removed = await removeSpend(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id });
    return removed ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
  });
}
