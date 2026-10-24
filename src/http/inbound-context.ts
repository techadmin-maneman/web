// What a provider's hook gives the inbound port (src/domain/messages/inbound.ts): the request's database, clock and
// ways to answer.

import type { Context } from "hono";
import type { InboundContext } from "../domain/messages/inbound.ts";
import type { AppEnv } from "./context.ts";
import { opsInputs } from "./ops-inputs.ts";
import { queueMessage } from "./queue-message.ts";

/** The secret a provider's hook sends as "Authorization: Bearer <token>", kept out of every URL a proxy logs. */
export const bearerToken = (c: Context<AppEnv>): string =>
  c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";

export function inboundContext(c: Context<AppEnv>): InboundContext {
  return {
    db: c.env.DB,
    now: c.var.deps.now(),
    requestId: c.var.requestId,
    messaging: c.var.deps.messaging,
    messagingSettings: c.var.config.settings.messaging,
    careHours: async () => (await opsInputs(c)).careHours,
    queue: (messageId) => queueMessage(c, messageId),
  };
}
