// The Care inbox, behind Access (Customer Care; docs/decisions/0129-the-care-inbox.md):
//   GET /api/conversations?view=   the threads of a view, the latest first: mine (my clients'), open, waiting, closed or all
//   GET /api/conversations/:id     one thread: what the client wrote, our replies and notes, and our automatic messages
//   POST /api/conversations/:id/replies   a reply from our number, kept in the thread whether it went or not
//   POST /api/conversations/:id/notes     a note for staff alone
//   POST /api/conversations/:id/close     the thread closed with what it was about

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import type { Context } from "hono";
import { actorOf, staffMemberOf } from "../../http/audit.ts";
import type { AppEnv } from "../../http/context.ts";
import { conversationThread, INBOX_VIEWS, listConversations } from "../../domain/care/inbox.ts";
import { addNote, CLOSE_REASONS, closeConversation, replyTo } from "../../domain/care/replies.ts";

const ConversationSchema = z
  .object({
    id: z.uuid(),
    person: z.union([z.object({ id: z.uuid(), name: z.string() }).strict(), z.null()]).openapi({
      description: "The client whose number it is; null for a number we do not know.",
    }),
    mobile: z.string(),
    state: z.enum(["open", "waiting", "closed"]),
    care_person: z.union([z.string(), z.null()]).openapi({
      description: "The client's Care person, by e-mail; null for a number we do not know, or a client not given one.",
    }),
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
        delivery: z.union([z.enum(["sent", "failed"]), z.null()]),
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

const ThreadSchema = z
  .object({ conversation: ConversationSchema, items: z.array(ItemSchema) })
  .strict()
  .openapi("ConversationThread");

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
      ...json(ThreadSchema),
    },
    403: errorResponse("access_required"),
    404: errorResponse("not_found"),
  },
});

const Id = z.object({ id: z.uuid() });
const TextBody = z.object({ text: z.string().trim().min(1).max(4096) }).strict();
const answered = { description: "The thread as it now stands", ...json(ThreadSchema) };

const replyRoute = createRoute({
  method: "post",
  path: "/api/conversations/{id}/replies",
  summary: "Reply from our number; the reply is kept in the thread, sent or failed with why",
  request: { params: Id, body: { required: true, ...json(TextBody.openapi("ChatReply")) } },
  responses: {
    200: answered,
    403: errorResponse("access_required"),
    404: errorResponse("not_found: no such thread, or its client's record is erased"),
    503: errorResponse("unavailable: the WhatsApp provider sends no free text yet"),
  },
});

const noteRoute = createRoute({
  method: "post",
  path: "/api/conversations/{id}/notes",
  summary: "A note on the thread for staff alone, never sent",
  request: { params: Id, body: { required: true, ...json(TextBody.openapi("ChatNote")) } },
  responses: { 200: answered, 403: errorResponse("access_required"), 404: errorResponse("not_found") },
});

const closeRoute = createRoute({
  method: "post",
  path: "/api/conversations/{id}/close",
  summary: "Close the thread with what it was about; the client writing again reopens it",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(
        z
          .object({ reason: z.enum(CLOSE_REASONS) })
          .strict()
          .openapi("ChatClose"),
      ),
    },
  },
  responses: { 200: answered, 403: errorResponse("access_required"), 404: errorResponse("not_found") },
});

/** Who acts, and when, as each change records it. */
const changeOf = (c: Context<AppEnv>, conversationId: string) => ({
  conversationId,
  actor: actorOf(c),
  requestId: c.var.requestId,
  now: c.var.deps.now(),
});

function registerAnswers(app: App): void {
  app.openapi(replyRoute, async (c) => {
    const { id } = c.req.valid("param");
    const replied = await replyTo(c.env.DB, c.var.deps.messaging, {
      ...changeOf(c, id),
      text: c.req.valid("json").text,
    });
    if (replied === "not_found" || replied === "erased") return refuse(c, "not_found");
    if (replied === "unavailable") return refuse(c, "unavailable");
    const thread = await conversationThread(c.env.DB, id);
    return thread === null ? refuse(c, "not_found") : c.json(thread, 200);
  });

  app.openapi(noteRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await addNote(c.env.DB, { ...changeOf(c, id), text: c.req.valid("json").text })) === "not_found") {
      return refuse(c, "not_found");
    }
    const thread = await conversationThread(c.env.DB, id);
    return thread === null ? refuse(c, "not_found") : c.json(thread, 200);
  });

  app.openapi(closeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const closed = await closeConversation(c.env.DB, { ...changeOf(c, id), reason: c.req.valid("json").reason });
    if (closed === "not_found") return refuse(c, "not_found");
    const thread = await conversationThread(c.env.DB, id);
    return thread === null ? refuse(c, "not_found") : c.json(thread, 200);
  });
}

export function registerOpsConversations(app: App): void {
  registerAnswers(app);
  app.openapi(listRoute, async (c) => {
    const me = staffMemberOf(c)?.id ?? "";
    return c.json({ conversations: await listConversations(c.env.DB, c.req.valid("query").view, me) }, 200);
  });

  app.openapi(threadRoute, async (c) => {
    const thread = await conversationThread(c.env.DB, c.req.valid("param").id);
    if (thread === null) return refuse(c, "not_found");
    return c.json(thread, 200);
  });
}
