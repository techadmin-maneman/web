// POST /api/stop: the site's /stop page, opened from the link a reminder or the launch alert ends with. One tap
// withdraws the consent the message was sent under, without signing in (src/domain/stop-messages.ts). The signed
// token is the only key, so the route needs no Turnstile; it is never logged, being in the body.

import { createRoute, z } from "@hono/zod-openapi";
import type { App } from "../http/context.ts";
import { errorBody, errorResponse } from "../http/errors.ts";
import { visitorOf } from "../http/visitor.ts";
import { readStopToken, withdraw } from "../domain/stop-messages.ts";
import { MESSAGE_PURPOSES } from "../policy/consents.ts";

export const StopMessagesRequestSchema = z
  .object({ token: z.string().min(1).max(600) })
  .strict()
  .openapi("StopMessagesRequest");

export const StoppedMessagesSchema = z
  .object({
    purpose: z.enum(MESSAGE_PURPOSES).openapi({
      description: "What is no longer sent. The same answer when it had been stopped already.",
    }),
  })
  .strict()
  .openapi("StoppedMessages");

export const stopMessagesRoute = createRoute({
  method: "post",
  path: "/api/stop",
  summary: "Stops the messages a reminder's or alert's link names, by withdrawing the consent they were sent under",
  request: { body: { content: { "application/json": { schema: StopMessagesRequestSchema } }, required: true } },
  responses: {
    200: { description: "Stopped", content: { "application/json": { schema: StoppedMessagesSchema } } },
    400: errorResponse("invalid_request: no token"),
    404: errorResponse("not_found: the link is not ours, or has expired"),
  },
});

export function registerStopMessages(app: App): void {
  app.openapi(stopMessagesRoute, async (c) => {
    const { config, deps, requestId, log } = c.var;
    const now = deps.now();
    const subject = await readStopToken(config.settings.tryon.linkSigningKey, c.req.valid("json").token, now);
    if (subject === null) return c.json(errorBody("not_found", requestId), 404);

    const withdrawn = await withdraw(c.env.DB, {
      personId: subject.personId,
      purposes: [subject.purpose],
      source: "message_link",
      ipHash: (await visitorOf(c)).ipHash,
      requestId,
      now,
    });
    log.info("messages_stopped", { purpose: subject.purpose, withdrawn: withdrawn.length });
    return c.json({ purpose: subject.purpose }, 200);
  });
}
