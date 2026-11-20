// The acquisition figures, behind Access (Growth · View; docs/decisions/0288-attribution-and-conversions.md): for a week
// (Monday to Sunday) or a month in India, by channel, from our own rows (../../domain/analytics/acquisition.ts).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { acquisition } from "../../domain/analytics/acquisition.ts";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";
import { addDays, addMonths, indiaDate, indiaInstant, monthOf, weekdayOf } from "../../lib/india-time.ts";
import { CHANNEL_CODES } from "../../policy/channels.ts";
import { HEARD_FROM_CODES } from "../../policy/heard-from.ts";

const FIGURES = {
  spend: z.number().int().openapi({ description: "Paise, before GST." }),
  leads: z.number().int().openapi({ description: "Clients whose first lead came in the period." }),
  consults_booked: z.number().int(),
  consults_done: z.number().int(),
  first_fits: z.number().int().openapi({ description: "Clients whose first fit was paid in the period." }),
  first_fit_revenue: z.number().int().openapi({ description: "Paise, before GST, less refunds." }),
};

const AcquisitionSchema = z
  .object({
    period: z.enum(["week", "month"]),
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "The period's last day." }),
    by: z.enum(["first", "last"]),
    rows: z.array(z.object({ channel: z.enum(CHANNEL_CODES), ...FIGURES }).strict()),
    totals: z.object(FIGURES).strict(),
    cohorts: z.array(
      z
        .object({
          channel: z.enum(CHANNEL_CODES),
          clients: z.number().int(),
          d30: z.number().int(),
          d90: z.number().int(),
          d180: z.number().int(),
        })
        .strict(),
    ),
    cohort_complete: z.object({ d30: z.boolean(), d90: z.boolean(), d180: z.boolean() }).strict(),
    heard: z.array(
      z
        .object({
          heard_from: z.enum([...HEARD_FROM_CODES, "not_asked"]),
          channel: z.enum(CHANNEL_CODES),
          clients: z.number().int(),
        })
        .strict(),
    ),
    tryons: z.number().int().openapi({ description: "First looks at the try-on in the period." }),
  })
  .strict()
  .openapi("Acquisition");

const acquisitionRoute = opsRoute({
  method: "get",
  path: "/api/growth/acquisition",
  summary: "Spend, leads, consultations, first fits and their revenue by channel, for a week or a month",
  request: {
    query: z.object({
      period: z.enum(["week", "month"]).default("week"),
      starting: z.iso.date().optional().openapi({
        description: "A day in the week or month wanted; this week or month where left out.",
      }),
      by: z.enum(["first", "last"]).default("first").openapi({
        description: "The client's channel, or their last touch's when each thing happened.",
      }),
      channel: z.enum(CHANNEL_CODES).optional(),
    }),
  },
  responses: { 200: { description: "The figures", ...json(AcquisitionSchema) } },
});

/** The period a day falls in: its week from Monday, or its month. */
function periodOf(period: "week" | "month", day: string): { from: string; next: string } {
  if (period === "month") return { from: `${monthOf(day)}-01`, next: `${addMonths(monthOf(day), 1)}-01` };
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));
  return { from: monday, next: addDays(monday, 7) };
}

export function registerOpsFunnel(app: App): void {
  app.openapi(acquisitionRoute, async (c) => {
    const { period, starting, by, channel } = c.req.valid("query");
    const now = c.var.deps.now();
    const { from, next } = periodOf(period, starting ?? indiaDate(now));
    const figures = await acquisition(
      c.env.DB,
      {
        from: indiaInstant(from, "00:00").toISOString(),
        to: indiaInstant(next, "00:00").toISOString(),
        fromDate: from,
        toDate: next,
      },
      { by, channel: channel ?? null, now },
    );
    return c.json(
      {
        period,
        from,
        to: addDays(next, -1),
        by,
        ...figures,
        rows: [...figures.rows],
        cohorts: [...figures.cohorts],
        heard: figures.heard.map((row) => ({
          ...row,
          heard_from: HEARD_FROM_CODES.find((code) => code === row.heard_from) ?? ("not_asked" as const),
        })),
      },
      200,
    );
  });
}
