// The Care inbox, behind Access (Customer Care; docs/decisions/0129-the-care-inbox.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { App } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { CursorQuery, cursorOf, NextCursor, placeOf } from "../../http/paging.ts";
import type { Context } from "hono";
import { actorOf, staffMemberOf } from "../../http/audit.ts";
import { opsInputs } from "../../http/ops-inputs.ts";
import { queueCrmContact } from "../../http/contact-sync.ts";
import type { AppEnv } from "../../http/context.ts";
import {
  conversationThread,
  INBOX_VIEWS,
  listConversations,
  PAGE_THREADS,
  type InboxContext,
} from "../../domain/care/inbox.ts";
import { coverOn } from "../../domain/care/cover.ts";
import { indiaDate } from "../../lib/india-time.ts";
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
    care_name: z.union([z.string(), z.null()]).openapi({
      description: "The first name clients know the Care person by, once a manager has set it; null until then.",
    }),
    technician: z.union([z.object({ id: z.string(), name: z.string() }).strict(), z.null()]).openapi({
      description: "One of our technicians, by their number on record; Operations answer them.",
    }),
    covered_by: z.union([z.string(), z.null()]).openapi({
      description: "Who covers the Care person today, while they are off; null while they are on.",
    }),
    last_message_at: z.iso.datetime(),
    last_line: z.union([z.string(), z.null()]),
    waiting_since: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "When the client last wrote, unanswered since; null when nothing waits on us.",
    }),
    reply_by: z.union([z.iso.datetime(), z.null()]).openapi({
      description: "When our reply is due, by the Care hours ops set (care_hours); null when nothing waits on us.",
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

const listRoute = opsRoute({
  method: "get",
  path: "/api/conversations",
  summary: "The Care inbox's threads of a view, the latest first, a page at a time",
  request: {
    query: z.object({
      view: z.enum(INBOX_VIEWS).default("open"),
      search: z.string().trim().max(80).optional().openapi({
        description: "A client's name, or a number, or part of either.",
      }),
      cursor: CursorQuery,
    }),
  },
  responses: {
    200: {
      description: "The threads",
      ...json(
        z
          .object({
            conversations: z
              .array(ConversationSchema)
              .openapi({ description: `At most ${String(PAGE_THREADS)}, the latest first.` }),
            next_cursor: NextCursor,
          })
          .strict()
          .openapi("Conversations"),
      ),
    },
    400: errorResponse("invalid_request: a cursor this list did not give"),
  },
});

/** A thread's place in the list, as the inbox gives it: when it last moved, and its id. */
const THREAD_PLACE = /^[^_]+_[^_]+$/;

const threadRoute = opsRoute({
  method: "get",
  path: "/api/conversations/{id}",
  summary: "One thread: the chat and our automatic messages to the client, in order",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: "The thread",
      ...json(ThreadSchema),
    },
    404: errorResponse("not_found"),
  },
});

const Id = z.object({ id: z.uuid() });
const TextBody = z.object({ text: z.string().trim().min(1).max(4096) }).strict();
const answered = { description: "The thread as it now stands", ...json(ThreadSchema) };

const replyRoute = opsRoute({
  method: "post",
  path: "/api/conversations/{id}/replies",
  summary: "Reply from our number; the reply is kept in the thread, sent or failed with why",
  request: { params: Id, body: { required: true, ...json(TextBody.openapi("ChatReply")) } },
  responses: {
    200: answered,
    404: errorResponse("not_found: no such thread, or its client's record is erased"),
    503: errorResponse("unavailable: the WhatsApp provider sends no free text yet"),
  },
});

const noteRoute = opsRoute({
  method: "post",
  path: "/api/conversations/{id}/notes",
  summary: "A note on the thread for staff alone, never sent",
  request: { params: Id, body: { required: true, ...json(TextBody.openapi("ChatNote")) } },
  responses: { 200: answered, 404: errorResponse("not_found") },
});

const closeRoute = opsRoute({
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
  responses: { 200: answered, 404: errorResponse("not_found") },
});

/** The Care hours ops set, and who covers whom today. */
async function inboxContext(c: Context<AppEnv>): Promise<InboxContext> {
  const [{ careHours }, cover] = await Promise.all([opsInputs(c), coverOn(c.env.DB, indiaDate(c.var.deps.now()))]);
  return { hours: careHours, cover };
}

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
    const replied = await replyTo(c.env.DB, c.var.deps.messaging, c.var.config.settings.messaging, {
      ...changeOf(c, id),
      text: c.req.valid("json").text,
    });
    if (replied === "not_found" || replied === "erased") return refuse(c, "not_found");
    if (replied === "unavailable") return refuse(c, "unavailable");
    const thread = await conversationThread(c.env.DB, c.env.BACKUPS, id, await inboxContext(c));
    return thread === null ? refuse(c, "not_found") : c.json(thread, 200);
  });

  app.openapi(noteRoute, async (c) => {
    const { id } = c.req.valid("param");
    if ((await addNote(c.env.DB, { ...changeOf(c, id), text: c.req.valid("json").text })) === "not_found") {
      return refuse(c, "not_found");
    }
    const thread = await conversationThread(c.env.DB, c.env.BACKUPS, id, await inboxContext(c));
    return thread === null ? refuse(c, "not_found") : c.json(thread, 200);
  });

  app.openapi(closeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const closed = await closeConversation(c.env.DB, { ...changeOf(c, id), reason: c.req.valid("json").reason });
    if (closed === "not_found") return refuse(c, "not_found");
    const thread = await conversationThread(c.env.DB, c.env.BACKUPS, id, await inboxContext(c));
    if (thread === null) return refuse(c, "not_found");
    // The client's CRM lead gets when they were last in touch, and what about.
    if (thread.conversation.person !== null) await queueCrmContact(c, thread.conversation.person.id);
    return c.json(thread, 200);
  });
}

export function registerOpsConversations(app: App): void {
  registerAnswers(app);
  app.openapi(listRoute, async (c) => {
    const me = staffMemberOf(c)?.id ?? "";
    const { view, search, cursor } = c.req.valid("query");
    const before = cursor === undefined ? undefined : placeOf(cursor);
    if (before === null || (before !== undefined && !THREAD_PLACE.test(before))) return refuse(c, "invalid_request");
    const page = await listConversations(c.env.DB, { view, me, search, before }, await inboxContext(c));
    const next = page.nextBefore === null ? null : cursorOf(page.nextBefore);
    return c.json({ conversations: page.conversations, next_cursor: next }, 200);
  });

  app.openapi(threadRoute, async (c) => {
    const thread = await conversationThread(c.env.DB, c.env.BACKUPS, c.req.valid("param").id, await inboxContext(c));
    if (thread === null) return refuse(c, "not_found");
    return c.json(thread, 200);
  });
}
