// The site's words as the Words page last published them (docs/decisions/0127-publishing-the-words.md), which each
// build of this environment's site fetches and lays over its copy (scripts/build/build-site.ts), and how long each
// kind of visit is booked for, which its prose says, and when Customer Care are on, which its business details give as
// opening hours (docs/decisions/0325-search-pages-and-opening-hours.md). Published words, the services' lengths and
// Care's times are the site's own text and the console's, so nothing here is private; staging's hosts sit behind
// Access as ever.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { offeredServices } from "../../domain/booking/services.ts";
import { latestPublish } from "../../domain/words/publish.ts";
import { STANDARD_TIER, VISIT_TYPES } from "../../config/visit-types.ts";
import { indiaDate } from "../../lib/india-time.ts";
import { opsInputs } from "../../http/ops-inputs.ts";

const SiteWordsSchema = z
  .object({
    id: z.union([z.uuid(), z.null()]).openapi({ description: "The publish; null before any." }),
    published_at: z.union([z.iso.datetime(), z.null()]),
    words: z
      .record(z.string(), z.string())
      .openapi({ description: "Each changed line's key, as src/config/words.json names it, and its words." }),
    lengths: z.record(z.enum(VISIT_TYPES), z.union([z.number().int(), z.null()])).openapi({
      description:
        "Each kind's visit length in minutes, as ops set it on its standard service, else its first offered today; null for a kind offering nothing.",
    }),
    care_times: z
      .object({ opens: z.number().int(), closes: z.number().int() })
      .strict()
      .openapi({ description: "When Customer Care are on, in minutes past midnight in India, as ops set them." }),
  })
  .strict()
  .openapi("SiteWords");

const siteWordsRoute = createRoute({
  method: "get",
  path: "/api/site-words",
  summary: "The site's words as last published, which each build of the site lays over its copy",
  responses: {
    200: { description: "The latest publish", content: { "application/json": { schema: SiteWordsSchema } } },
  },
});

export function registerSiteWords(app: App): void {
  app.openapi(siteWordsRoute, async (c) => {
    const [publish, offered, inputs] = await Promise.all([
      latestPublish(c.env.DB),
      offeredServices(c.env.DB, indiaDate(c.var.deps.now())),
      opsInputs(c),
    ]);
    const lengthOf = (kind: (typeof VISIT_TYPES)[number]) => {
      const ofKind = offered.filter((service) => service.kind === kind);
      return (ofKind.find((service) => service.tier === STANDARD_TIER) ?? ofKind[0])?.minutes ?? null;
    };
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        id: publish?.id ?? null,
        published_at: publish?.published_at ?? null,
        words: publish?.words ?? {},
        lengths: {
          consultation: lengthOf("consultation"),
          first_fit: lengthOf("first_fit"),
          service: lengthOf("service"),
          replacement: lengthOf("replacement"),
        },
        care_times: { opens: inputs.careHours.opens, closes: inputs.careHours.closes },
      },
      200,
    );
  });
}
