// The Care inbox, behind Access (Customer Care; docs/decisions/0129-the-care-inbox.md):
//   GET /api/conversations?view=   the threads of a view: open, waiting, closed or all, the latest first
//   GET /api/conversations/:id     one thread: what the client wrote, our replies and notes, and our automatic messages

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { conversationThread, INBOX_VIEWS, listConversations } from "../../domain/care/inbox.ts";

const ConversationSchema = z
  .object({
    id: z.uuid(),
    person: z.union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()]).openapi({
      description: "The client whose number it is; null for a number we do not know.",
    }),
    mobile: z.string(),
    state: z.enum(["open", "waiting", "closed"]),
    last_message_at: z.iso.datetime(),
    last_line: z.union([z.string(), z.null()]),
    waiting_since: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "When the client last wrote, unanswered since; null when nothing waits on us.",
    }),
  })
  .strict()
  .openapi("Conversation");

const ItemSchema = z
  .union([
    z
      .object({
        kind: z.enum(["in", "out", "note"]),
        at: z.iso.datetime(),
        author: z.string(),
        text: z.union([z.string(), z.null()]),
      })
      .strict(),
    z
      .object({
        kind: z.literal("auto"),
        at: z.iso.datetime(),
        message: z.string().openapi({ description: "The automatic message's kind, as outbound_messages names it." }),
        state: z.string(),
        delivered_at: z.union([z.iso.datetime(), z.null()]),
        read_at: z.union([z.iso.datetime(), z.null()]),
      })
      .strict(),
  ])
  .openapi("ThreadItem");

const listRoute = createRoute({
  method: "get",
  path: "/api/conversations",
  summary: "The Care inbox's threads of a view, the latest first",
  request: { query: z.object({ view: z.enum(INBOX_VIEWS).default("open") }) },
  responses: {
    200: {
      description: "The threads",
      ...json(
        z
          .object({ conversations: z.array(ConversationSchema) })
          .strict()
          .openapi("Conversations"),
      ),
    },
    403: errorResponse("access_required"),
  },
});

const threadRoute = createRoute({
  method: "get",
  path: "/api/conversations/{id}",
  summary: "One thread: the chat and our automatic messages to the client, in order",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The thread",
      ...json(
        z
          .object({ conversation: ConversationSchema, items: z.array(ItemSchema) })
          .strict()
          .openapi("ConversationThread"),
      ),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

export function registerOpsConversations(app: App): void {
  app.openapi(listRoute, async (c) =>
    c.json({ conversations: await listConversations(c.env.DB, c.req.valid("query").view) }, 200),
  );

  app.openapi(threadRoute, async (c) => {
    const thread = await conversationThread(c.env.DB, c.req.valid("param").id);
    if (thread === null) return refuse(c, "not_found");
    return c.json(thread, 200);
  });
}
