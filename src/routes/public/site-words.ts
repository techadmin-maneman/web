// The site's words as the Words page last published them (docs/decisions/0127-publishing-the-words.md), which each
// build of this environment's site fetches and lays over its copy (scripts/build/build-site.ts). Published words are
// the site's own text, so nothing here is private; staging's hosts sit behind Access as ever.
//
//   GET /api/site-words    the latest publish: each changed line's key and words

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { latestPublish } from "../../domain/words/publish.ts";

const SiteWordsSchema = z
  .object({
    id: z.union([z.uuid(), z.null()]).openapi({ description: "The publish; null before any." }),
    published_at: z.union([z.iso.datetime(), z.null()]),
    words: z
      .record(z.string(), z.string())
      .openapi({ description: "Each changed line's key, as src/config/words.json names it, and its words." }),
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
    const publish = await latestPublish(c.env.DB);
    c.header("Cache-Control", "no-store");
    return c.json(
      { id: publish?.id ?? null, published_at: publish?.published_at ?? null, words: publish?.words ?? {} },
      200,
    );
  });
}
