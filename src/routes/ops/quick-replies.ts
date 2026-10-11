// Saved answers for the Care inbox, behind Access (Customer Care; docs/decisions/0141-quick-replies.md):
//   GET /api/quick-replies                the answers on the list, by title
//   POST /api/quick-replies               an answer added, as a Customer Care manager does
//   POST /api/quick-replies/:id/retire    an answer taken off the list

import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf } from "../../http/audit.ts";
import { addQuickReply, quickReplies, retireQuickReply } from "../../domain/care/quick-replies.ts";

const QuickReplySchema = z
  .object({
    id: z.uuid(),
    title: z.string(),
    text: z
      .string()
      .openapi({ description: "{name} and {next_visit} are filled in with the client's when it is used." }),
  })
  .strict()
  .openapi("QuickReply");

const listRoute = createRoute({
  method: "get",
  path: "/api/quick-replies",
  summary: "The saved answers on the list, by title",
  responses: {
    200: { description: "The answers", ...json(z.object({ replies: z.array(QuickReplySchema) }).strict()) },
    403: errorResponse("access_required"),
  },
});

const addRoute = createRoute({
  method: "post",
  path: "/api/quick-replies",
  summary: "Add a saved answer to the list",
  request: {
    body: {
      required: true,
      ...json(
        z
          .object({ title: z.string().trim().min(1).max(60), text: z.string().trim().min(1).max(1000) })
          .strict()
          .openapi("QuickReplyNew"),
      ),
    },
  },
  responses: { 200: { description: "Added", ...json(QuickReplySchema) }, 403: errorResponse("access_required") },
});

const retireRoute = createRoute({
  method: "post",
  path: "/api/quick-replies/{id}/retire",
  summary: "Take a saved answer off the list",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: { description: "Taken off", ...json(z.object({ ok: z.literal(true) }).strict()) },
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such answer on the list"),
  },
});

const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsQuickReplies(app: App): void {
  app.openapi(listRoute, async (c) => c.json({ replies: await quickReplies(c.env.DB) }, 200));

  app.openapi(addRoute, async (c) => {
    const { title, text } = c.req.valid("json");
    return c.json(await addQuickReply(c.env.DB, { ...changeOf(c), title, text }), 200);
  });

  app.openapi(retireRoute, async (c) => {
    const retired = await retireQuickReply(c.env.DB, { ...changeOf(c), id: c.req.valid("param").id });
    return retired ? c.json({ ok: true as const }, 200) : refuse(c, "not_found");
  });
}
