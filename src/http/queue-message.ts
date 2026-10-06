// Messages already written to the outbox in D1, put on the messaging queue for this request. One the queue refuses
// is sent by the sweeper minutes later (src/scheduled/unsent-messages.ts), so the request goes on either way.

import type { Context } from "hono";
import { enqueue, enqueueBatch } from "../domain/platform/enqueue.ts";
import type { AppEnv } from "./context.ts";
import { type MessagingMessage } from "../config/pipeline.ts";

export async function queueMessage(c: Context<AppEnv>, messageId: string): Promise<void> {
  const body = { message_id: messageId, request_id: c.var.requestId } satisfies MessagingMessage;
  await enqueue(c.env.MESSAGE_QUEUE, body, { log: c.var.log, ifLost: "sweeper" });
}

/** Messages each held back for its own number of seconds, so that a long run of them leaves in a paced line. */
export async function queuePacedMessages(
  c: Context<AppEnv>,
  messages: readonly { readonly id: string; readonly delaySeconds: number }[],
): Promise<void> {
  const requests = messages.map((message) => ({
    body: { message_id: message.id, request_id: c.var.requestId } satisfies MessagingMessage,
    delaySeconds: message.delaySeconds,
  }));
  await enqueueBatch(c.env.MESSAGE_QUEUE, requests, { log: c.var.log, ifLost: "sweeper" });
}
