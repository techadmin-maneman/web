// The Words page, behind Access (Growth; docs/decisions/0126-the-words-page.md):
//   GET  /api/words                every line of the site and every WhatsApp message to a client, with its wording
//   GET  /api/words/history?key=   every wording one line has had
//   POST /api/words                a line given new words, or put back to the code's

import { createRoute, z } from "@hono/zod-openapi";
import { actorOf } from "../../http/audit.ts";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { listWords, setWord, wordHistory } from "../../domain/words/words.ts";

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
  })
  .strict()
  .openapi("Word");

const listRoute = createRoute({
  method: "get",
  path: "/api/words",
  summary: "Every line of the site and every WhatsApp message to a client, with the wording in force",
  responses: {
    200: {
      description: "The lines",
      ...json(
        z
          .object({ words: z.array(WordSchema) })
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
    200: { description: "The line as it now stands", ...json(z.object({ word: WordSchema }).strict()) },
    400: errorResponse(
      "invalid_request: fields names text.empty, text.holes (one the page fills taken out or added), text.price, " +
        "text.visits, text.placeholder, text.length, text.first_line or text.ends_on_detail",
    ),
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

export function registerOpsWords(app: App): void {
  app.openapi(listRoute, async (c) => c.json({ words: await listWords(c.env.DB) }, 200));

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
    return c.json({ word: set.word }, 200);
  });
}
