// Spend, behind Access (Growth; docs/decisions/0150-spend.md, amended by 0288): entries by the day, typed, or taken from
// Google's or Meta's daily CSV, which the console reads and sends as rows.

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { importSpend } from "../../domain/money/spend-import.ts";
import { addSpend, removeSpend, spendSince } from "../../domain/money/spend.ts";
import { actorOf } from "../../http/audit.ts";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { addMonths, indiaDate, monthOf } from "../../lib/india-time.ts";
import { SPEND_CHANNELS } from "../../policy/channels.ts";

/** How far back the page lists, and how far back an entry may be put. */
const MONTHS_LISTED = 13;

/** The most rows one CSV may bring, written in one batch: a month of days for 30 campaigns. */
const IMPORT_ROWS_MAX = 900;

const DaySchema = z.iso.date().openapi({ description: "YYYY-MM-DD, India's day." });
const PaiseSchema = z.number().int().min(100).max(10_000_000_000).openapi({ description: "Paise, before GST." });

const SpendEntrySchema = z
  .object({
    id: z.uuid(),
    month: z.string().openapi({ description: "YYYY-MM." }),
    spent_date: z
      .union([DaySchema, z.null()])
      .openapi({ description: "Null for an entry made for its whole month, before entries had a day." }),
    city: z.union([z.string(), z.null()]).openapi({ description: "Null for spend not aimed at one city." }),
    channel: z.enum(SPEND_CHANNELS),
    campaign: z.union([z.string(), z.null()]),
    amount: z.number().int().openapi({ description: "Paise, before GST." }),
    note: z.union([z.string(), z.null()]),
    source: z.enum(["manual", "csv", "link", "api"]).openapi({
      description: "Typed here, taken from an ad account's CSV, a society activation's cost, or an API.",
    }),
    link_id: z.union([z.uuid(), z.null()]),
    cost_line: z.union([z.enum(["stall", "staff", "collateral", "other"]), z.null()]),
    entered_by: z.string(),
    entered_at: z.iso.datetime(),
  })
  .strict()
  .openapi("SpendEntry");

const listRoute = opsRoute({
  method: "get",
  path: "/api/spend",
  summary: "The last thirteen months' spend, the latest day first",
  responses: {
    200: {
      description: "The entries, and the cities and channels an entry may name",
      ...json(
        z
          .object({
            entries: z.array(SpendEntrySchema),
            cities: z.array(z.string()),
            channels: z.array(z.enum(SPEND_CHANNELS)),
            first_day: DaySchema.openapi({ description: "The earliest day an entry may be put on." }),
            today: DaySchema.openapi({ description: "India's day now, the latest an entry may be put on." }),
          })
          .strict()
          .openapi("SpendList"),
      ),
    },
  },
});

const addRoute = opsRoute({
  method: "post",
  path: "/api/spend",
  summary: "Add a day's spend",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            day: DaySchema,
            city: z.union([z.string().trim().min(1).max(60), z.null()]),
            channel: z.enum(SPEND_CHANNELS),
            campaign: z.string().trim().min(1).max(120).optional().openapi({
              description: "As the campaign is named, starting with its city or with national.",
            }),
            amount: PaiseSchema,
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
      "invalid_request: fields names day for one outside the list's days, or city for one we do not hold",
    ),
  },
});

const importRoute = opsRoute({
  method: "post",
  path: "/api/spend/import",
  summary: "Add a Google Ads or Meta Ads CSV's daily spend by campaign, each campaign's city by its name",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({
            platform: z.enum(["google", "meta"]),
            rows: z
              .array(
                z
                  .object({
                    day: DaySchema,
                    campaign: z.string().trim().min(1).max(120),
                    amount: z.number().int().min(1).max(10_000_000_000).openapi({ description: "Paise, before GST." }),
                  })
                  .strict(),
              )
              .min(1)
              .max(IMPORT_ROWS_MAX),
          })
          .strict()
          .openapi("SpendImport"),
      ),
    },
  },
  responses: {
    200: {
      description: "Added",
      ...json(z.object({ added: z.number().int() }).strict().openapi("SpendImported")),
    },
    400: errorResponse("invalid_request: fields names rows for a day outside the list's days"),
    409: errorResponse("already_imported: these rows were imported before and are still on the figures"),
  },
});

const removeRoute = opsRoute({
  method: "post",
  path: "/api/spend/{id}/remove",
  summary: "Take an entry off the figures",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Taken off", ...json(z.object({ ok: z.literal(true) }).strict()) },
    404: errorResponse("not_found: no such entry on the figures"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

/** India's day now, and the first day of the earliest month the page lists. */
const daysOf = (now: Date) => {
  const today = indiaDate(now);
  return { today, firstDay: `${addMonths(monthOf(today), 1 - MONTHS_LISTED)}-01` };
};

export function registerOpsSpend(app: App): void {
  app.openapi(listRoute, async (c) => {
    const { today, firstDay } = daysOf(c.var.deps.now());
    const [entries, cities] = await Promise.all([
      spendSince(c.env.DB, firstDay.slice(0, 7)),
      c.env.DB.prepare("SELECT name FROM cities ORDER BY sort").all<{ name: string }>(),
    ]);
    return c.json(
      {
        entries,
        cities: cities.results.map((city) => city.name),
        channels: [...SPEND_CHANNELS],
        first_day: firstDay,
        today,
      },
      200,
    );
  });

  app.openapi(addRoute, async (c) => {
    const body = c.req.valid("json");
    const { today, firstDay } = daysOf(c.var.deps.now());
    if (body.day < firstDay || body.day > today) return refuse(c, "invalid_request", ["day"]);
    const added = await addSpend(c.env.DB, {
      ...changeOf(c),
      spent_date: body.day,
      city: body.city,
      channel: body.channel,
      campaign: body.campaign ?? null,
      amount: body.amount,
      note: body.note ?? null,
    });
    if (added === "no_city") return refuse(c, "invalid_request", ["city"]);
    return c.json(added, 200);
  });

  app.openapi(importRoute, async (c) => {
    const { platform, rows } = c.req.valid("json");
    const { today, firstDay } = daysOf(c.var.deps.now());
    if (rows.some((row) => row.day < firstDay || row.day > today)) return refuse(c, "invalid_request", ["rows"]);
    const imported = await importSpend(c.env.DB, { ...changeOf(c), platform, rows });
    if (imported === "already_imported") return refuse(c, "already_imported");
    return c.json({ added: imported }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const removed = await removeSpend(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id });
    return removed ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
  });
}
