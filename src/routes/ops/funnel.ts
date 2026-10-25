// The growth funnel, behind Access (Growth · View): over the last days asked, the first try-ons, and the clients whose
// first lead came then by what they went on to do, all of them and by channel (../../domain/analytics/funnel.ts).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import { growthFunnel } from "../../domain/analytics/funnel.ts";
import type { App } from "../../http/context.ts";
import { json } from "../../http/openapi.ts";
import { addDays, indiaDate, indiaInstant } from "../../lib/india-time.ts";
import { CHANNELS } from "../../policy/channels.ts";

const PERIODS = ["30", "90"] as const;

const STEPS = {
  leads: z.number().int().openapi({ description: "Clients whose first lead in the period came then." }),
  booked: z.number().int().openapi({ description: "Of those, how many booked a consultation." }),
  consulted: z.number().int().openapi({ description: "Had one, or a first fit, which counts as one." }),
  fitted: z.number().int().openapi({ description: "Were fitted." }),
};

const FunnelSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date().openapi({ description: "The last day counted." }),
    tryons: z
      .number()
      .int()
      .openapi({ description: "First looks at the try-on, a second look of one photo not again." }),
    steps: z.object(STEPS).strict(),
    channels: z.array(
      z.object({ channel: z.enum(CHANNELS.map((each) => each.channel) as [string, ...string[]]), ...STEPS }).strict(),
    ),
  })
  .strict()
  .openapi("GrowthFunnel");

const funnelRoute = opsRoute({
  method: "get",
  path: "/api/growth/funnel",
  summary: "The growth funnel over the last 30 or 90 days: try-ons, then leads to consultations to fits, by channel",
  request: { query: z.object({ days: z.enum(PERIODS).default("30") }) },
  responses: { 200: { description: "The funnel", ...json(FunnelSchema) } },
});

export function registerOpsFunnel(app: App): void {
  app.openapi(funnelRoute, async (c) => {
    const days = Number(c.req.valid("query").days);
    const today = indiaDate(c.var.deps.now());
    const from = addDays(today, 1 - days);
    const funnel = await growthFunnel(c.env.DB, indiaInstant(from, "00:00"), indiaInstant(addDays(today, 1), "00:00"));
    return c.json({ from, to: today, ...funnel, channels: [...funnel.channels] }, 200);
  });
}
