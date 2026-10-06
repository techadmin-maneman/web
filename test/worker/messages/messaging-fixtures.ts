// What the messaging tests share (messaging*.test.ts): a logger and a message as the queue carries it.

import { env } from "cloudflare:workers";
import { createLogger } from "../../../src/log.ts";

export const log = createLogger();

export function message(id = "m1") {
  return env.DB.prepare(
    "SELECT state, attempts, provider_message_id, last_error, sent_at, sending_at FROM outbound_messages WHERE id = ?",
  )
    .bind(id)
    .first();
}
