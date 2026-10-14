// The Words page, behind Access (Growth; docs/decisions/0126-the-words-page.md, 0127-publishing-the-words.md).

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { latestPublish, publishSite, type SitePublish } from "../../domain/words/publish.ts";
import { listWords, setWord, wordHistory, type Word } from "../../domain/words/words.ts";

const WordSchema = z
  .object({
    key: z.string().openapi({ description: "The line's key in src/config/words.json." }),
    surface: z.enum(["site", "message"]),
    group: z.string().openapi({ description: "The page, or Messages." }),
    where: z.string().openapi({ description: "The part of the page, or the message's name." }),
    text: z.string().openapi({ description: "The wording in the code." }),
    now: z.string().openapi({ description: "The wording in force: the one set here, else the code's." }),
    changed: z.union([z.object({ by: z.string(), at: z.iso.datetime() }).strict(), z.null()]),
    longest: z.number().int().openapi({ description: "The longest the line may grow, in characters." }),
    on_site: z.union([z.boolean(), z.null()]).openapi({
      description: "For a line of the site, whether its last publish has the wording in force; null for a message.",
    }),
  })
  .strict()
  .openapi("Word");

const PublishSchema = z
  .object({ at: z.iso.datetime(), by: z.string(), lines: z.number().int() })
  .strict()
  .openapi("WordsPublish");

const publishedOf = (publish: SitePublish) => ({
  at: publish.published_at,
  by: publish.published_by,
  lines: publish.lines,
});

/** A line, with whether the site's last publish has its wording in force. */
const withSite = (word: Word, publish: SitePublish | null) => ({
  ...word,
  on_site: word.surface === "message" ? null : (publish?.words[word.key] ?? word.text) === word.now,
});

const listRoute = createRoute({
  method: "get",
  path: "/api/words",
  summary: "Every line of the site and every WhatsApp message to a client, with the wording in force",
  responses: {
    200: {
      description: "The lines, and when the site's words were last published",
      ...json(
        z
          .object({
            words: z.array(WordSchema),
            published: z.union([PublishSchema, z.null()]),
            messages: z.enum(["at_once", "after_approval"]).openapi({
              description:
                "Whether messages send in new words at once, as the bridge's plain text does, or only once WhatsApp " +
                "approves them, as MSG91's templates do (docs/decisions/0128-messages-with-the-words-set.md).",
            }),
          })
          .strict()
          .openapi("Words"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const historyRoute = createRoute({
  method: "get",
  path: "/api/words/history",
  summary: "Every wording one line has had, newest first",
  request: { query: z.object({ key: z.string().min(1).max(200) }) },
  responses: {
    200: {
      description: "The line's wordings; a null text went back to the code's",
      ...json(
        z
          .object({
            versions: z.array(
              z
                .object({
                  id: z.uuid(),
                  text: z.union([z.string(), z.null()]),
                  set_by: z.string(),
                  set_at: z.iso.datetime(),
                })
                .strict(),
            ),
          })
          .strict()
          .openapi("WordHistory"),
      ),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

const setRoute = createRoute({
  method: "post",
  path: "/api/words",
  summary: "Give a line new words, or put it back to the code's with a null text",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ key: z.string().min(1).max(200), text: z.union([z.string().max(4000), z.null()]) })
          .strict()
          .openapi("WordSet"),
      ),
    },
  },
  responses: {
    200: {
      description: "The line as it now stands",
      ...json(z.object({ word: WordSchema }).strict().openapi("WordAnswer")),
    },
    400: errorResponse(
      "invalid_request: fields names text.empty, text.holes (one the page fills taken out or added), text.price, " +
        "text.visits, text.placeholder, text.length, text.first_line or text.ends_on_detail",
    ),
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

const publishRoute = createRoute({
  method: "post",
  path: "/api/words/publish",
  summary: "Publish the site's changed words, which each build of this environment's site lays over its copy",
  responses: {
    200: {
      description: "The publish",
      ...json(z.object({ published: PublishSchema }).strict().openapi("WordsPublished")),
    },
    403: errorResponse("access_required"),
  },
});

export function registerOpsWords(app: App): void {
  app.openapi(listRoute, async (c) => {
    const [words, publish] = await Promise.all([listWords(c.env.DB), latestPublish(c.env.DB)]);
    const published = publish === null ? null : publishedOf(publish);
    const messages =
      c.var.config.settings.messaging.msg91 === null ? ("at_once" as const) : ("after_approval" as const);
    return c.json({ words: words.map((word) => withSite(word, publish)), published, messages }, 200);
  });

  app.openapi(historyRoute, async (c) => {
    const versions = await wordHistory(c.env.DB, c.req.valid("query").key);
    if (versions === null) return refuse(c, "not_found");
    return c.json({ versions }, 200);
  });

  app.openapi(setRoute, async (c) => {
    const { key, text } = c.req.valid("json");
    const set = await setWord(c.env.DB, {
      key,
      text,
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    if (set.outcome === "not_found") return refuse(c, "not_found");
    if (set.outcome !== "set") return refuse(c, "invalid_request", [`text.${set.outcome}`]);
    return c.json({ word: withSite(set.word, await latestPublish(c.env.DB)) }, 200);
  });

  app.openapi(publishRoute, async (c) => {
    const publish = await publishSite(c.env.DB, {
      actor: actorOf(c),
      requestId: c.var.requestId,
      now: c.var.deps.now(),
    });
    return c.json({ published: publishedOf(publish) }, 200);
  });
}
