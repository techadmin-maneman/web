// What the site's pages report of their visitor (docs/decisions/0288-attribution-and-conversions.md):
//
// - POST /api/visits: a landing, from the page's own script, kept as a touch where it is the visitor's first or a
//   campaign's; it answers the reference the visitor's WhatsApp message ends with. A browser the site's Worker gave no
//   visitor cookie, or an address past its hour's reports, is answered with nothing kept.
// - GET /api/links/{kind}/{slug}: where a campaign link sends the visitor, for the site's Worker, which redirects
//   /s/<slug> and /o/<slug> there.

import { createRoute, z } from "@hono/zod-openapi";
import { landingOfLink } from "../../domain/growth/campaign-links.ts";
import { recordVisit } from "../../domain/attribution/page-visit.ts";
import { takeOne } from "../../domain/sign-in/rate-limit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { visitContextOf } from "../../http/visit-context.ts";
import { visitorOf } from "../../http/visitor.ts";
import { TouchSchema } from "../schemas/attribution.ts";

const VisitAnswerSchema = z
  .object({
    ref: z.union([z.string(), z.null()]).openapi({
      example: "M7K2Q",
      description: 'What the visitor\'s WhatsApp message ends with, "Ref M7K2Q"; null where nothing was kept.',
    }),
  })
  .strict()
  .openapi("VisitAnswer");

const visitRoute = createRoute({
  method: "post",
  path: "/api/visits",
  summary: "A page's report of its visitor's landing, kept where it is their first or a campaign's",
  request: { body: { required: true, content: { "application/json": { schema: TouchSchema } } } },
  responses: {
    200: { description: "Seen", content: { "application/json": { schema: VisitAnswerSchema } } },
    400: errorResponse("invalid_request"),
  },
});

const linkRoute = createRoute({
  method: "get",
  path: "/api/links/{kind}/{slug}",
  summary: "Where a campaign link sends the visitor: /book with its tags and its code",
  request: {
    params: z.object({ kind: z.enum(["s", "o"]), slug: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  },
  responses: {
    200: {
      description: "The link's landing",
      content: {
        "application/json": {
          schema: z
            .object({ landing: z.string().startsWith("/book?") })
            .strict()
            .openapi("LinkLanding"),
        },
      },
    },
    404: errorResponse("not_found: no live link has that slug"),
  },
});

export function registerVisits(app: App): void {
  app.openapi(visitRoute, async (c) => {
    const { visitorId } = visitContextOf(c);
    if (visitorId === null) return c.json({ ref: null }, 200);
    const db = c.env.DB;
    const now = c.var.deps.now();
    const { ipHash } = await visitorOf(c);
    if (!(await takeOne(db, "visit:ip", ipHash, { now, settings: c.var.config.settings }))) {
      return c.json({ ref: null }, 200);
    }
    const { ref } = await recordVisit(db, { visitorId, page: c.req.valid("json"), now });
    return c.json({ ref }, 200);
  });

  app.openapi(linkRoute, async (c) => {
    const { kind, slug } = c.req.valid("param");
    const landing = await landingOfLink(c.env.DB, kind, slug);
    return landing === null ? refuse(c, "not_found") : c.json({ landing }, 200);
  });
}
