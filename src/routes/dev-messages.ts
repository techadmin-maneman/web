// POST /api/dev/messages — locally only. A message a number wrote to our WhatsApp number, taken through the same port
// the bridge's hook takes it through (src/domain/messages/inbound.ts), so the Care inbox can be run on a laptop: its
// thread, its reply clock, a STOP. Locally every message goes to the stub, so nothing reaches a phone.
//
// It exists only where DEV_ROUTES is on, which the startup guard refuses outside local, and only local apps register
// it (src/app.ts). It is in no API document: nothing but a developer calls it (docs/getting-started.md).

import { createRoute, z } from "@hono/zod-openapi";
import { takeInbound } from "../domain/messages/inbound.ts";
import type { App } from "../http/context.ts";
import { inboundContext } from "../http/inbound-context.ts";

const messageRoute = createRoute({
  method: "post",
  path: "/api/dev/messages",
  summary: "Locally only: a message a number wrote to our WhatsApp number",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ mobile: z.string().regex(/^\+\d{8,15}$/), text: z.string().min(1).max(4096) }).strict(),
        },
      },
    },
  },
  responses: { 204: { description: "Taken, as the bridge's hook takes one" } },
});

export function registerDevMessages(app: App): void {
  app.openapi(messageRoute, async (c) => {
    const { mobile, text } = c.req.valid("json");
    const providerMessageId = `local-${crypto.randomUUID()}`;
    await takeInbound(inboundContext(c), [{ kind: "message", mobileE164: mobile, text, providerMessageId }]);
    return c.body(null, 204);
  });
}
