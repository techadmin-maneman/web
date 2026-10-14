// A chat from a number we don't know, behind Access (Customer Care Act; docs/decisions/0138-strangers-in-the-inbox.md).

import { opsRoute } from "../../http/session-routes.ts";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { App, AppEnv } from "../../http/context.ts";
import { errorResponse, refuse } from "../../http/errors.ts";
import { json } from "../../http/openapi.ts";
import { actorOf } from "../../http/audit.ts";
import { linkChat, saveStranger } from "../../domain/care/strangers.ts";
import { testRecordAtCreation } from "../../policy/staging-test-records.ts";
import { CHANNEL_CODES } from "../../policy/channels.ts";
import { enqueue } from "../../domain/platform/enqueue.ts";

const Id = z.object({ id: z.uuid() });
const linked = errorResponse("invalid_request: fields names conversation when the chat is a client's already");

const linkRoute = opsRoute({
  method: "post",
  path: "/api/conversations/{id}/link",
  summary: "Link a chat from a number we don't know to the client it turns out to be",
  request: {
    params: Id,
    body: { required: true, ...json(z.object({ person_id: z.uuid() }).strict().openapi("ChatLink")) },
  },
  responses: {
    200: { description: "Linked", ...json(z.object({ person_id: z.uuid() }).strict()) },
    400: linked,
    404: errorResponse("not_found: no such chat, or no such client"),
  },
});

const saveRoute = opsRoute({
  method: "post",
  path: "/api/conversations/{id}/save",
  summary: "Save the person behind a chat from a number we don't know as someone new, and their WhatsApp lead",
  request: {
    params: Id,
    body: {
      required: true,
      ...json(
        z
          .object({
            name: z.string().trim().min(1).max(80),
            found_us: z
              .enum(CHANNEL_CODES)
              .optional()
              .openapi({ description: "How they told Care they found us; left out where they did not say." }),
          })
          .strict()
          .openapi("ChatSave"),
      ),
    },
  },
  responses: {
    200: { description: "Saved", ...json(z.object({ person_id: z.uuid() }).strict()) },
    400: linked,
    404: errorResponse("not_found: no such chat"),
    409: errorResponse("number_in_use: one of our people has this number already; link the chat to them"),
  },
});

/** Who acts, and when, as each change records it. */
const changeOf = (c: Context<AppEnv>) => ({ actor: actorOf(c), requestId: c.var.requestId, now: c.var.deps.now() });

export function registerOpsStrangers(app: App): void {
  app.openapi(linkRoute, async (c) => {
    const personId = c.req.valid("json").person_id;
    const done = await linkChat(c.env.DB, { ...changeOf(c), conversationId: c.req.valid("param").id, personId });
    if (done === "not_found" || done === "no_client") return refuse(c, "not_found");
    if (done === "known") return refuse(c, "invalid_request", ["conversation"]);
    return c.json({ person_id: personId }, 200);
  });

  app.openapi(saveRoute, async (c) => {
    const { name, found_us: foundUs } = c.req.valid("json");
    const saved = await saveStranger(c.env.DB, {
      ...changeOf(c),
      conversationId: c.req.valid("param").id,
      name,
      foundUs: foundUs ?? null,
      testRecord: testRecordAtCreation(c.var.config.environment, name),
    });
    if (saved === "not_found") return refuse(c, "not_found");
    if (saved === "known") return refuse(c, "invalid_request", ["conversation"]);
    if (saved === "has_number") return refuse(c, "number_in_use");
    // A lead lost on the way is the sweeper's to send, as any lead is.
    const toCrm = { lead_id: saved.leadId, request_id: c.var.requestId };
    await enqueue(c.env.CRM_QUEUE, toCrm, { log: c.var.log, ifLost: "sweeper" });
    return c.json({ person_id: saved.personId }, 200);
  });
}
